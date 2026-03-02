import { AgentMode, AgentState, UIState, AgentResponse } from './types/agent.types';
import { StateManager } from './state/StateManager';
import { NotebookAgent } from './NotebookAgent';

/**
 * WebSocket message types for agent communication
 */
export enum AgentWebSocketMessageType {
  // Client -> Server
  SEND_MESSAGE = 'send_message',
  SET_MODE = 'set_mode',
  GET_STATE = 'get_state',
  GET_INTROSPECTION = 'get_introspection',
  EXECUTE_CODE = 'execute_code',
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',

  // Server -> Client
  MESSAGE_RESPONSE = 'message_response',
  STATE_UPDATE = 'state_update',
  INTROSPECTION_DATA = 'introspection_data',
  EXECUTION_RESULT = 'execution_result',
  ERROR = 'error',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
}

/**
 * Base WebSocket message structure
 */
export interface WebSocketMessage<T = unknown> {
  type: AgentWebSocketMessageType;
  payload: T;
  timestamp: number;
  messageId?: string;
}

/**
 * Client message payloads
 */
export interface SendMessagePayload {
  message: string;
}

export interface SetModePayload {
  mode: AgentMode;
}

export interface ExecuteCodePayload {
  code: string;
  timeout?: number;
}

export interface SubscribePayload {
  notebookId: string;
}

/**
 * Server response payloads
 */
export interface MessageResponsePayload {
  response: AgentResponse;
}

export interface StateUpdatePayload {
  agentState: AgentState;
  uiState: UIState;
  changedFields: string[];
}

export interface ConnectedPayload {
  notebookId: string;
  currentMode: AgentMode;
  timestamp: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * WebSocket server configuration
 */
export interface WebSocketServerConfig {
  port: number;
  host?: string;
  path?: string;
}

/**
 * Client connection info
 */
interface ClientConnection {
  id: string;
  notebookId: string;
  subscribed: boolean;
  lastActivity: number;
}

/**
 * WebSocketServer - Handles WebSocket connections for real-time agent communication
 * 
 * Responsibilities:
 * - Manage client connections and disconnections
 * - Parse and route incoming messages to appropriate handlers
 * - Broadcast state changes to subscribed clients
 * - Handle mode changes, message sending, and state requests
 */
export class WebSocketServer {
  private config: WebSocketServerConfig;
  private stateManager: StateManager | null = null;
  private notebookAgent: NotebookAgent | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  private messageHandlers: Map<AgentWebSocketMessageType, (client: ClientConnection, payload: unknown) => Promise<unknown>> = new Map();
  private unsubscribeState: (() => void) | null = null;
  private isRunning: boolean = false;

  constructor(config: Partial<WebSocketServerConfig> = {}) {
    this.config = {
      port: config.port || 8080,
      host: config.host || 'localhost',
      path: config.path || '/ws/agent',
      ...config,
    };

    this.setupMessageHandlers();
  }

  /**
   * Set up message handlers for different message types
   */
  private setupMessageHandlers(): void {
    this.messageHandlers.set(AgentWebSocketMessageType.SEND_MESSAGE, this.handleSendMessage.bind(this));
    this.messageHandlers.set(AgentWebSocketMessageType.SET_MODE, this.handleSetMode.bind(this));
    this.messageHandlers.set(AgentWebSocketMessageType.GET_STATE, this.handleGetState.bind(this));
    this.messageHandlers.set(AgentWebSocketMessageType.GET_INTROSPECTION, this.handleGetIntrospection.bind(this));
    this.messageHandlers.set(AgentWebSocketMessageType.EXECUTE_CODE, this.handleExecuteCode.bind(this));
    this.messageHandlers.set(AgentWebSocketMessageType.SUBSCRIBE, this.handleSubscribe.bind(this));
    this.messageHandlers.set(AgentWebSocketMessageType.UNSUBSCRIBE, this.handleUnsubscribe.bind(this));
    this.messageHandlers.set(AgentWebSocketMessageType.CONNECT, this.handleConnect.bind(this));
    this.messageHandlers.set(AgentWebSocketMessageType.DISCONNECT, this.handleDisconnect.bind(this));
  }

  /**
   * Bind the server to a StateManager for state broadcasting
   */
  bindStateManager(stateManager: StateManager): void {
    this.stateManager = stateManager;

    // Subscribe to state changes and broadcast to clients
    this.unsubscribeState = stateManager.subscribe((changes) => {
      if (changes.agent || changes.ui) {
        this.broadcastStateUpdate(changes);
      }
    });
  }

  /**
   * Bind the server to a NotebookAgent for message processing
   */
  bindNotebookAgent(agent: NotebookAgent): void {
    this.notebookAgent = agent;
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('WebSocketServer is already running');
      return;
    }

    this.isRunning = true;
    console.log(`WebSocketServer starting on ${this.config.host}:${this.config.port}${this.config.path}`);
    // Server startup logic would go here
    // In a real implementation, this would create an HTTP server and upgrade connections
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.warn('WebSocketServer is not running');
      return;
    }

    this.isRunning = false;

    // Cleanup subscriptions
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }

    // Close all client connections
    for (const [clientId] of this.clients) {
      await this.disconnectClient(clientId);
    }

    console.log('WebSocketServer stopped');
  }

  /**
   * Handle incoming WebSocket message
   */
  async handleMessage(clientId: string, message: WebSocketMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      console.warn(`Received message from unknown client: ${clientId}`);
      return;
    }

    // Update last activity
    client.lastActivity = Date.now();

    // Find and execute handler
    const handler = this.messageHandlers.get(message.type);
    if (!handler) {
      await this.sendError(client, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`);
      return;
    }

    try {
      const result = await handler(client, message.payload);
      await this.sendResponse(client, message.type, result, message.messageId);
    } catch (error) {
      console.error(`Error handling message ${message.type}:`, error);
      await this.sendError(client, 'HANDLER_ERROR', error instanceof Error ? error.message : 'Unknown error', message.messageId);
    }
  }

  /**
   * Handle client connection
   */
  private async handleConnect(client: ClientConnection, payload: unknown): Promise<ConnectedPayload> {
    const notebookId = (payload as SubscribePayload)?.notebookId || 'default-notebook';

    client.notebookId = notebookId;
    client.lastActivity = Date.now();

    console.log(`Client ${client.id} connected to notebook: ${notebookId}`);

    return {
      notebookId,
      currentMode: this.stateManager?.getMode() || 'ASK',
      timestamp: Date.now(),
    };
  }

  /**
   * Handle client disconnection
   */
  private async handleDisconnect(client: ClientConnection, _payload: unknown): Promise<void> {
    await this.disconnectClient(client.id);
  }

  /**
   * Handle sending a message to the agent
   */
  private async handleSendMessage(client: ClientConnection, payload: unknown): Promise<MessageResponsePayload> {
    if (!this.notebookAgent) {
      throw new Error('NotebookAgent not bound to WebSocketServer');
    }

    const { message } = payload as SendMessagePayload;
    const response = await this.notebookAgent.processMessage(message);

    return { response };
  }

  /**
   * Handle mode change request
   */
  private async handleSetMode(client: ClientConnection, payload: unknown): Promise<{ mode: AgentMode }> {
    if (!this.notebookAgent) {
      throw new Error('NotebookAgent not bound to WebSocketServer');
    }

    const { mode } = payload as SetModePayload;
    await this.notebookAgent.setMode(mode);

    return { mode };
  }

  /**
   * Handle state request
   */
  private async handleGetState(_client: ClientConnection, _payload: unknown): Promise<StateUpdatePayload> {
    if (!this.stateManager) {
      throw new Error('StateManager not bound to WebSocketServer');
    }

    return {
      agentState: this.stateManager.getAgentState(),
      uiState: this.stateManager.getUIState(),
      changedFields: ['all'],
    };
  }

  /**
   * Handle introspection data request
   */
  private async handleGetIntrospection(_client: ClientConnection, _payload: unknown): Promise<unknown> {
    if (!this.notebookAgent) {
      throw new Error('NotebookAgent not bound to WebSocketServer');
    }

    return this.notebookAgent.getIntrospectionData();
  }

  /**
   * Handle code execution request
   */
  private async handleExecuteCode(_client: ClientConnection, payload: unknown): Promise<unknown> {
    // Code execution would be delegated to the kernel interface
    // This is a placeholder for the actual implementation
    const { code, timeout } = payload as ExecuteCodePayload;
    console.log(`Executing code with timeout ${timeout}: ${code.substring(0, 100)}...`);

    return { success: false, error: 'Code execution not implemented' };
  }

  /**
   * Handle subscription to state updates
   */
  private async handleSubscribe(client: ClientConnection, payload: unknown): Promise<{ subscribed: boolean }> {
    const { notebookId } = payload as SubscribePayload;

    client.notebookId = notebookId;
    client.subscribed = true;

    console.log(`Client ${client.id} subscribed to notebook: ${notebookId}`);

    // Send current state immediately
    if (this.stateManager) {
      await this.sendToClient(client.id, {
        type: AgentWebSocketMessageType.STATE_UPDATE,
        payload: {
          agentState: this.stateManager.getAgentState(),
          uiState: this.stateManager.getUIState(),
          changedFields: ['initial'],
        },
        timestamp: Date.now(),
      });
    }

    return { subscribed: true };
  }

  /**
   * Handle unsubscription from state updates
   */
  private async handleUnsubscribe(client: ClientConnection, _payload: unknown): Promise<{ subscribed: boolean }> {
    client.subscribed = false;
    console.log(`Client ${client.id} unsubscribed`);

    return { subscribed: false };
  }

  /**
   * Broadcast state update to all subscribed clients
   */
  private broadcastStateUpdate(changes: { agent?: AgentState; ui?: UIState }): void {
    if (!this.stateManager) return;

    const agentState = changes.agent || this.stateManager.getAgentState();
    const uiState = changes.ui || this.stateManager.getUIState();

    // Determine changed fields
    const changedFields: string[] = [];
    if (changes.agent) changedFields.push('agentState');
    if (changes.ui) changedFields.push('uiState');

    const payload: StateUpdatePayload = {
      agentState,
      uiState,
      changedFields: changedFields.length > 0 ? changedFields : ['all'],
    };

    for (const [clientId, client] of this.clients) {
      if (client.subscribed) {
        this.sendToClient(clientId, {
          type: AgentWebSocketMessageType.STATE_UPDATE,
          payload,
          timestamp: Date.now(),
        }).catch(err => {
          console.error(`Failed to send state update to client ${clientId}:`, err);
        });
      }
    }
  }

  /**
   * Send response to client
   */
  private async sendResponse<T>(
    client: ClientConnection,
    originalType: AgentWebSocketMessageType,
    result: T,
    messageId?: string
  ): Promise<void> {
    await this.sendToClient(client.id, {
      type: originalType,
      payload: result,
      timestamp: Date.now(),
      messageId,
    });
  }

  /**
   * Send error to client
   */
  private async sendError(client: ClientConnection, code: string, message: string, messageId?: string): Promise<void> {
    await this.sendToClient(client.id, {
      type: AgentWebSocketMessageType.ERROR,
      payload: { code, message } as ErrorPayload,
      timestamp: Date.now(),
      messageId,
    });
  }

  /**
   * Send message to specific client (to be implemented with actual WebSocket)
   */
  private async sendToClient(clientId: string, message: WebSocketMessage): Promise<void> {
    // This would be implemented with actual WebSocket send
    // For now, just log the message
    console.log(`[WS -> ${clientId}] ${message.type}`, message.payload);
  }

  /**
   * Register a new client connection
   */
  registerClient(clientId: string, notebookId: string = 'default-notebook'): ClientConnection {
    const client: ClientConnection = {
      id: clientId,
      notebookId,
      subscribed: false,
      lastActivity: Date.now(),
    };

    this.clients.set(clientId, client);
    return client;
  }

  /**
   * Disconnect a client
   */
  private async disconnectClient(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (client) {
      console.log(`Disconnecting client: ${clientId}`);

      await this.sendToClient(clientId, {
        type: AgentWebSocketMessageType.DISCONNECTED,
        payload: { clientId },
        timestamp: Date.now(),
      });

      this.clients.delete(clientId);
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Check if server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get server configuration
   */
  getConfig(): WebSocketServerConfig {
    return { ...this.config };
  }
}

export default WebSocketServer;