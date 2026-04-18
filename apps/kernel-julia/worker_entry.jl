"""
Standalone Worker Entry Point for Isolated Julia Code Execution

Communicates via JSON-RPC over stdin/stderr (to avoid conflicts with stdout capture).
Compatible with the controller-node JuliaWorker.ts.

Protocol:
  - Reads JSON commands from stdin (one per line)
  - Writes JSON responses to stderr (IPC channel)
  - Stdout from user code is captured and streamed as {"type":"stream","stream":"stdout",...}
  - Commands: EXECUTE, COMPLETE, SNAPSHOT, SHUTDOWN
"""

# Capture the original stderr BEFORE any redirection — used as the IPC channel
# (equivalent to Python's sys.__stderr__)
const _IPC_CHANNEL = stderr

# Ensure Pkg is available and load JSON dependency
import Pkg

function _ensure_json()
    try
        @eval using JSON
        return true
    catch
        try
            Pkg.add("JSON"; io=devnull)
            @eval using JSON
            return true
        catch e
            return false
        end
    end
end

if !_ensure_json()
    write(_IPC_CHANNEL, """{"status":"error","message":"Failed to load JSON package"}\n""")
    flush(_IPC_CHANNEL)
    exit(1)
end

# ── IPC helpers ──────────────────────────────────────────────────────────────

function write_response(data::Dict)
    try
        println(_IPC_CHANNEL, JSON.json(data))
        flush(_IPC_CHANNEL)
    catch
        # If IPC channel fails there is nothing we can do
    end
end

# ── Code execution ────────────────────────────────────────────────────────────

function execute_with_capture(code_str::String, mod::Module)
    start_time = time()

    # Create pipes to capture the raw stdout/stderr
    out_pipe = Pipe()
    err_pipe = Pipe()
    Base.link_pipe!(out_pipe)
    Base.link_pipe!(err_pipe)

    # Accumulators for the final response (in case frontend doesn't use streaming)
    out_accum = IOBuffer()
    err_accum = IOBuffer()

    # Background tasks to read from pipes and send JSON events
    out_task = @async begin
        while !eof(out_pipe)
            data = readavailable(out_pipe)
            if !isempty(data)
                s = String(data)
                write(out_accum, s)
                write_response(Dict("type" => "stream", "stream" => "stdout", "data" => s))
            end
        end
    end

    err_task = @async begin
        while !eof(err_pipe)
            data = readavailable(err_pipe)
            if !isempty(data)
                s = String(data)
                write(err_accum, s)
                write_response(Dict("type" => "stream", "stream" => "stderr", "data" => s))
            end
        end
    end

    try
        write_response(Dict("type" => "execution_start"))

        # Redirect stdout and stderr using native pipes
        redirect_stdout(out_pipe) do
            redirect_stderr(err_pipe) do
                include_string(mod, code_str, "<cell>")
            end
        end

        # Close the write ends of the pipes so the reader tasks can finish
        close(out_pipe.in)
        close(err_pipe.in)

        # Wait for reader tasks to process remaining data
        wait(out_task)
        wait(err_task)

        write_response(Dict("type" => "execution_end"))

        duration = time() - start_time
        return Dict(
            "status"         => "success",
            "stdout"         => String(take!(out_accum)),
            "stderr"         => String(take!(err_accum)),
            "execution_time" => duration,
            "outputs"        => []
        )
    catch e
        # Close pipes if they are still open
        isopen(out_pipe.in) && close(out_pipe.in)
        isopen(err_pipe.in) && close(err_pipe.in)

        duration = time() - start_time

        err_buf = IOBuffer()
        showerror(err_buf, e, catch_backtrace())
        err_msg = String(take!(err_buf))

        # Also capture any partial stdout gathered before the error
        partial_stdout = String(take!(out_accum))

        return Dict(
            "status"         => "error",
            "stdout"         => partial_stdout,
            "stderr"         => err_msg,
            "error_details"  => err_msg,
            "execution_time" => duration,
            "outputs"        => []
        )
    end
end

# ── Code completion ───────────────────────────────────────────────────────────

function get_completions(code::String, cursor_pos::Int, mod::Module)
    try
        # Load REPL module for completion support
        isdefined(Base, :REPL) || @eval using REPL

        partial = code[1:min(cursor_pos, ncodeunits(code))]
        completions, _, _ = Base.REPL.completions(partial, cursor_pos, mod)

        result = Dict{String,Any}[]
        for c in completions
            text = Base.REPL.completion_text(c)
            # Map Julia completion types to the same schema the Python worker uses
            kind = if c isa Base.REPL.ModuleCompletion
                "module"
            elseif c isa Base.REPL.MethodCompletion
                "function"
            elseif c isa Base.REPL.KeywordCompletion
                "keyword"
            else
                "variable"
            end
            push!(result, Dict(
                "name"        => text,
                "type"        => kind,
                "description" => "",
                "docstring"   => ""
            ))
        end
        return result
    catch
        return Dict{String,Any}[]
    end
end

# ── Namespace snapshot ────────────────────────────────────────────────────────

function get_namespace_snapshot(mod::Module)
    vars = Dict{String,String}()
    try
        for sym in names(mod; all=false)
            try
                val = getfield(mod, sym)
                if !(val isa Function || val isa Module || val isa DataType || val isa UnionAll)
                    vars[string(sym)] = string(typeof(val))
                end
            catch
            end
        end
    catch
    end
    return vars
end

# ── Environment management helpers (Pkg.jl integration) ──────────────────────

function pkg_command(args::Vector{String})
    try
        # Support ] commands: add, rm, update, status, activate, instantiate
        cmd = join(args, " ")
        write_response(Dict("type" => "stream", "stream" => "stdout",
                            "data" => "[Pkg] Running: $cmd\n"))
        if length(args) >= 1
            if args[1] == "add"
                pkgs = args[2:end]
                Pkg.add(pkgs)
            elseif args[1] == "rm" || args[1] == "remove"
                pkgs = args[2:end]
                Pkg.rm(pkgs)
            elseif args[1] == "update"
                length(args) > 1 ? Pkg.update(args[2:end]) : Pkg.update()
            elseif args[1] == "status" || args[1] == "st"
                Pkg.status()
            elseif args[1] == "instantiate"
                Pkg.instantiate()
            elseif args[1] == "activate"
                length(args) > 1 ? Pkg.activate(args[2]) : Pkg.activate()
            end
        end
        write_response(Dict("type" => "stream", "stream" => "stdout",
                            "data" => "[Pkg] Done.\n"))
    catch e
        buf = IOBuffer()
        showerror(buf, e)
        write_response(Dict("type" => "stream", "stream" => "stderr",
                            "data" => "[Pkg] Error: $(String(take!(buf)))\n"))
    end
end

# ── Main worker loop ──────────────────────────────────────────────────────────

function worker_main()
    # Read initial config sent by JuliaWorker.ts on startup
    config_line = readline(stdin)
    _config = try
        JSON.parse(config_line)
    catch
        Dict{String,Any}()
    end

    # Signal ready to the TypeScript parent process
    write_response(Dict("status" => "ready"))

    # Create a persistent module for the user's session (analogous to Python's local_namespace)
    exec_mod = Module(:JuliaWorkerSession)

    # Pre-import Pkg into the session so users can call Pkg.add etc.
    Core.eval(exec_mod, :(import Pkg))

    # Main command loop
    while true
        line = try
            readline(stdin)
        catch
            break
        end

        isempty(line) && break

        try
            request = JSON.parse(line)
            command = get(request, "command", "")

            if command == "SHUTDOWN"
                break

            elseif command == "EXECUTE"
                code = get(request, "code", "")

                # Handle ] pkg magic commands  (e.g.  ] add DataFrames)
                stripped = strip(code)
                if startswith(stripped, "]")
                    pkg_args = split(strip(stripped[2:end]))
                    pkg_command(String.(pkg_args))
                    write_response(Dict(
                        "status"         => "success",
                        "stdout"         => "",
                        "stderr"         => "",
                        "execution_time" => 0.0,
                        "outputs"        => []
                    ))
                else
                    result = execute_with_capture(code, exec_mod)
                    write_response(result)
                end

            elseif command == "COMPLETE"
                code       = get(request, "code", "")
                cursor_pos = get(request, "cursor_pos", ncodeunits(code))
                completions = get_completions(code, cursor_pos, exec_mod)
                write_response(Dict("type" => "completions", "completions" => completions))

            elseif command == "SNAPSHOT"
                vars = get_namespace_snapshot(exec_mod)
                write_response(Dict("variables" => vars))
            end

        catch e
            err_buf = IOBuffer()
            showerror(err_buf, e, catch_backtrace())
            write_response(Dict(
                "status"         => "crashed",
                "stdout"         => "",
                "stderr"         => "",
                "error_details"  => "Worker loop error: $(String(take!(err_buf)))",
                "execution_time" => 0.0
            ))
        end
    end
end

worker_main()
