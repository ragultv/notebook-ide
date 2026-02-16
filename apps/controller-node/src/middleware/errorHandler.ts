import { FastifyRequest, FastifyReply, FastifyError } from 'fastify';

export class AppError extends Error {
    constructor(
        public statusCode: number,
        message: string,
        public code?: string
    ) {
        super(message);
        this.name = 'AppError';
    }
}

export class ValidationError extends AppError {
    constructor(message: string, public details?: any) {
        super(400, message, 'VALIDATION_ERROR');
        this.name = 'ValidationError';
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string) {
        super(404, `${resource} not found`, 'NOT_FOUND');
        this.name = 'NotFoundError';
    }
}

export class KernelError extends AppError {
    constructor(message: string) {
        super(500, message, 'KERNEL_ERROR');
        this.name = 'KernelError';
    }
}

export async function errorHandler(
    error: FastifyError | AppError,
    request: FastifyRequest,
    reply: FastifyReply
) {
    // Log error
    request.log.error({
        err: error,
        req: {
            method: request.method,
            url: request.url,
            headers: request.headers,
        },
    });

    // Handle known errors
    if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
            error: {
                code: error.code,
                message: error.message,
                ...(error instanceof ValidationError && error.details
                    ? { details: error.details }
                    : {}),
            },
        });
    }

    // Handle Fastify validation errors
    if (error.validation) {
        return reply.status(400).send({
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Validation failed',
                details: error.validation,
            },
        });
    }

    // Handle unknown errors
    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
        error: {
            code: 'INTERNAL_ERROR',
            message:
                process.env.NODE_ENV === 'production'
                    ? 'An internal error occurred'
                    : error.message,
        },
    });
}
