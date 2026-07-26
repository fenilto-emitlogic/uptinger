import { Response } from 'express';

// Safely embed a JSON value inside an inline <script> block in EJS via <%- jsonScript(x) %>.
// Plain JSON.stringify() doesn't escape "<", so a value containing "</script><script>..."
// (e.g. a user-controlled monitor name) would break out of the tag and execute as HTML/JS.
export function jsonScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

// Standardized Interface for Response Structure
export interface ApiResponse<T = any> {
    status: boolean;
    code: number;
    message: string;
    data: T;
    error: any;
}

/**
 * Sends a standardized success response.
 */
export function sendSuccess<T = any>(
    res: Response,
    message: string = 'Success',
    data: T = {} as T,
    code: number = 200
) {
    const response: ApiResponse<T> = {
        status: true,
        code,
        message,
        data,
        error: null,
    };
    return res.status(code).json(response);
}

/**
 * Sends a standardized error response.
 */
export function sendError(
    res: Response,
    message: string = 'An error occurred',
    error: any = null,
    code: number = 500,
    data: any = {}
) {
    const response: ApiResponse = {
        status: false,
        code,
        message,
        data,
        // Convert Error objects to readable string or keep object
        error: error instanceof Error ? error.message : error || message,
    };
    return res.status(code).json(response);
}