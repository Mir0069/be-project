import type { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';

export const validateRequest = (schema: ZodSchema<any>) => {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });
            if (result.body !== undefined) req.body = result.body;
            if (result.query !== undefined) {
                // Express 5 exposes req.query through a getter. Replacing the
                // value makes coerced/defaulted Zod fields available to controllers.
                Object.defineProperty(req, 'query', {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: result.query,
                });
            }
            if (result.params !== undefined) Object.assign(req.params, result.params);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const zodIssues = (error as any).issues || (error as any).errors || [];
                const errorMessages = zodIssues.map((issue: any) => ({
                    message: `${issue.path.join('.')} is ${issue.message}`,
                }));
                next(new AppError('Validation Error: ' + JSON.stringify(errorMessages), StatusCodes.BAD_REQUEST));
            } else {
                next(error);
            }
        }
    };
};
