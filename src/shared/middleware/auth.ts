import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../config";

export interface AuthUser {
  sub: string;
  role: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

const BEARER_PREFIX = "Bearer ";
const BEARER_PREFIX_LENGTH = BEARER_PREFIX.length;

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  let token: string | undefined;

  // Try to get token from Authorization header first
  const header = req.headers.authorization;
  if (header?.startsWith(BEARER_PREFIX)) {
    token = header.substring(BEARER_PREFIX_LENGTH);
  }
  
  // Fallback to cookie if header not present
  if (!token) {
    token = req.cookies?.token;
  }

  if (!token) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as AuthUser;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function requireRole(roles: string[]) {
  const allowedRoles = new Set(roles);
  
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthenticated" });
      return;
    }
    
    if (!allowedRoles.has(req.user.role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    
    next();
  };
}
