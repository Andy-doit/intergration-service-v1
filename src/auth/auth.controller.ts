import { Controller, Get, Post, Body, Res, Req, HttpException, HttpStatus } from '@nestjs/common';
import type { Response, Request } from 'express';

@Controller('admin')
export class AuthController {
  
  @Get('login')
  getLoginPage(@Req() req: Request, @Res() res: Response) {
    const errorMsg = req.query.error === '1' 
      ? '<div class="alert">Sai tài khoản hoặc mật khẩu!</div>' 
      : '';

    const html = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>G8HOME - Dashboard Login</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
          body { 
            background: #0f111a; 
            min-height: 100vh; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            color: #fff;
          }
          .login-container {
            background: #1a1d27;
            padding: 48px;
            border-radius: 16px;
            width: 100%;
            max-width: 420px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.05);
          }
          .logo {
            text-align: center;
            margin-bottom: 32px;
          }
          .logo h1 {
            font-size: 24px;
            font-weight: 700;
            background: linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 8px;
          }
          .logo p {
            color: #8b949e;
            font-size: 14px;
          }
          .form-group { margin-bottom: 20px; }
          .form-group label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 8px;
            color: #c9d1d9;
          }
          .form-group input {
            width: 100%;
            padding: 12px 16px;
            background: #0f111a;
            border: 1px solid #30363d;
            border-radius: 8px;
            color: #fff;
            font-size: 14px;
            transition: all 0.2s ease;
          }
          .form-group input:focus {
            outline: none;
            border-color: #FF8E53;
            box-shadow: 0 0 0 3px rgba(255, 142, 83, 0.15);
          }
          .alert {
            background: rgba(220, 53, 69, 0.1);
            color: #ff7b72;
            padding: 12px;
            border-radius: 8px;
            font-size: 13px;
            margin-bottom: 20px;
            border: 1px solid rgba(220, 53, 69, 0.2);
            text-align: center;
          }
          button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%);
            border: none;
            border-radius: 8px;
            color: #fff;
            font-weight: 600;
            font-size: 15px;
            cursor: pointer;
            transition: opacity 0.2s ease;
            margin-top: 8px;
          }
          button:hover {
            opacity: 0.9;
          }
        </style>
      </head>
      <body>
        <div class="login-container">
          <div class="logo">
            <h1>G8HOME MARKET</h1>
            <p>Hệ thống Quản trị Hàng Đợi (Queue Monitor)</p>
          </div>
          ${errorMsg}
          <form action="/admin/login" method="POST">
            <div class="form-group">
              <label>Tài khoản</label>
              <input type="text" name="username" placeholder="Nhập tài khoản" required autofocus>
            </div>
            <div class="form-group">
              <label>Mật khẩu</label>
              <input type="password" name="password" placeholder="Nhập mật khẩu" required>
            </div>
            <button type="submit">Đăng Nhập</button>
          </form>
        </div>
      </body>
      </html>
    `;
    res.type('html').send(html);
  }

  @Post('login')
  handleLogin(@Body() body: any, @Res() res: Response) {
    const validUser = process.env.ADMIN_USER ?? 'admin';
    const validPass = process.env.ADMIN_PASSWORD ?? 'g8homemarket';

    if (body.username === validUser && body.password === validPass) {
      // Set secure cookie valid for 24h
      res.cookie('admin_session', 'true', {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax',
      });
      return res.redirect('/admin/queues');
    }

    return res.redirect('/admin/login?error=1');
  }
}
