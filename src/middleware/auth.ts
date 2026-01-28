import { Request, Response, NextFunction } from "express";
import { prisma } from "../db";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: string;
  } | null;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  const authHeader = req.header("Authorization");

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    if (token) {
      try {
        const user = await prisma.user.findUnique({ where: { authToken: token } });
        if (user) {
          req.user = { id: user.id, email: user.email, role: user.role };
        }
      } catch (err) {
        console.error("Error in authMiddleware:", err);
      }
    }
  }

  next();
}
