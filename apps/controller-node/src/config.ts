import { FastifyRequest, FastifyReply } from 'fastify';

export interface AppConfig {
    port: number;
    host: string;
    env: 'development' | 'production' | 'test';
    cors: {
        origin: string | string[];
        credentials: boolean;
    };
    logging: {
        level: string;
        pretty: boolean;
    };
}

export const config: AppConfig = {
    port: parseInt(process.env.PORT || '3001', 10),
    host: process.env.HOST || '0.0.0.0',
    env: (process.env.NODE_ENV as any) || 'development',
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        credentials: true,
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        pretty: process.env.NODE_ENV !== 'production',
    },
};
