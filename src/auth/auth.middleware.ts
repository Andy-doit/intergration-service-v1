import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const session = req.cookies?.admin_session;
    const isLoginPath = req.path.includes('/admin/login');

    if (session === 'true' || isLoginPath) {
      next();
    } else {
      res.redirect('/admin/login');
    }
  }
}
