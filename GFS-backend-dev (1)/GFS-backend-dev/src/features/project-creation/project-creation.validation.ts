import { z } from 'zod';
import { ProjectType } from '@db/models/project.model';

export const createProjectSchema = z.object({
  body: z.object({
    projectName: z.string().trim().min(1, 'projectName is required'),
    projectType: z.nativeEnum(ProjectType).optional(),
    projectAddress: z.string().trim().optional(),
    description: z.string().trim().optional(),
    client: z
      .object({
        customerName: z.string().trim().optional(),
        customerEmail: z.string().trim().email().optional(),
        customerPhone: z.union([
          z.string().trim(),
          z.array(z.string().trim()).min(1),
        ]).optional(),
        company: z.string().trim().optional(),
        website: z.string().trim().optional(),
      })
      .optional(),
    address: z
      .object({
        street: z.string().trim().optional(),
        city: z.string().trim().optional(),
        state: z.string().trim().optional(),
        zipcode: z.string().trim().optional(),
        country: z.string().trim().optional(),
      })
      .optional(),
    estimator: z
      .object({
        id: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
        name: z.string().trim().optional(),
        email: z.string().trim().email().optional(),
        phone: z.string().trim().optional(),
      })
      .optional(),
  }),
});
