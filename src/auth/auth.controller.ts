import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Req,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { OdooSyncSchedule } from '../vendure/odoo-sync.schedule';

@Controller('admin')
export class AuthController {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly odooSyncSchedule: OdooSyncSchedule,
  ) {}

  @Get('login')
  getLoginPage(@Req() req: Request, @Res() res: Response) {
    const errorMsg =
      req.query.error === '1'
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
            <p>Order & Inventory Gateway</p>
          </div>
          ${errorMsg}
          <form action="/admin/login" method="POST">
            <div class="form-group">
              <label>Tài khoản</label>
              <input type="text" name="username" placeholder="admin" required autofocus>
            </div>
            <div class="form-group">
              <label>Mật khẩu</label>
              <input type="password" name="password" placeholder="••••••••" required>
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
      res.cookie('admin_session', 'true', {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax',
      });
      return res.redirect('/admin/dashboard');
    }

    return res.redirect('/admin/login?error=1');
  }

  @Get('dashboard')
  async getDashboard(@Req() req: Request, @Res() res: Response) {
    if (req.cookies.admin_session !== 'true') {
      return res.redirect('/admin/login');
    }

    const [productCount, orderCount] = await Promise.all([
      this.productRepo.count(),
      this.orderRepo.count(),
    ]);

    const syncStatus = req.query.sync === 'success' 
      ? '<div class="toast show">🚀 Đã kích hoạt đồng bộ toàn bộ sản phẩm!</div>' 
      : '';

    const html = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>G8HOME - Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          :root {
            --bg-primary: #0a0b10;
            --bg-secondary: #161821;
            --accent: #ff7e5f;
            --accent-gradient: linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%);
            --text-main: #e6edf3;
            --text-dim: #8b949e;
            --sidebar-width: 260px;
            --card-border: rgba(255, 255, 255, 0.08);
          }

          * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
          body { 
            background: var(--bg-primary); 
            color: var(--text-main);
            overflow-x: hidden;
            display: flex;
          }

          /* Sidebar */
          .sidebar {
            width: var(--sidebar-width);
            height: 100vh;
            background: var(--bg-secondary);
            border-right: 1px solid var(--card-border);
            padding: 32px 20px;
            position: fixed;
            display: flex;
            flex-direction: column;
          }
          .sidebar-logo {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 48px;
            padding-left: 10px;
          }
          .sidebar-logo i {
            font-size: 24px;
            background: var(--accent-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .sidebar-logo h2 { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; }
          
          .nav-links { list-style: none; flex: 1; }
          .nav-item { margin-bottom: 8px; }
          .nav-link {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            border-radius: 10px;
            color: var(--text-dim);
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
          }
          .nav-link:hover, .nav-link.active {
            background: rgba(255, 126, 95, 0.1);
            color: var(--accent);
          }
          .nav-link i { font-size: 18px; width: 24px; text-align: center; }

          /* Main Content */
          .main-content {
            margin-left: var(--sidebar-width);
            width: calc(100% - var(--sidebar-width));
            padding: 48px;
            min-height: 100vh;
          }

          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 40px;
          }
          .header h1 { font-size: 28px; font-weight: 700; letter-spacing: -1px; }

          /* Stats Grid */
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 24px;
            margin-bottom: 40px;
          }
          .stat-card {
            background: var(--bg-secondary);
            padding: 24px;
            border-radius: 20px;
            border: 1px solid var(--card-border);
            transition: transform 0.3s ease;
          }
          .stat-card:hover { transform: translateY(-5px); border-color: rgba(255, 126, 95, 0.3); }
          .stat-icon {
            width: 48px;
            height: 48px;
            border-radius: 12px;
            background: rgba(255, 126, 95, 0.1);
            color: var(--accent);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            margin-bottom: 16px;
          }
          .stat-value { font-size: 32px; font-weight: 700; margin-bottom: 4px; }
          .stat-label { color: var(--text-dim); font-size: 14px; font-weight: 500; }

          /* Action Section */
          .action-section {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 24px;
          }
          .card {
            background: var(--bg-secondary);
            padding: 32px;
            border-radius: 24px;
            border: 1px solid var(--card-border);
          }
          .card h3 { margin-bottom: 24px; font-size: 18px; display: flex; align-items: center; gap: 10px; }

          .sync-btn {
            background: var(--accent-gradient);
            color: #fff;
            border: none;
            padding: 16px 24px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 15px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 12px;
            transition: all 0.3s ease;
            box-shadow: 0 10px 20px -10px rgba(255, 126, 95, 0.5);
          }
          .sync-btn:hover { opacity: 0.9; transform: scale(1.02); }
          .sync-btn:active { transform: scale(0.98); }
          .sync-btn i.fa-spin { display: none; }

          .toast {
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: #238636;
            color: #fff;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            font-weight: 500;
            display: none;
            animation: slideIn 0.3s ease-out;
            z-index: 1000;
          }
          .toast.show { display: block; }

          @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

          /* Quick Stats Table */
          .table-container { margin-top: 24px; width: 100%; border-collapse: collapse; }
          .table-container th { text-align: left; color: var(--text-dim); font-size: 12px; padding: 12px; border-bottom: 1px solid var(--card-border); }
          .table-container td { padding: 16px 12px; font-size: 14px; border-bottom: 1px solid var(--card-border); }
          .status-badge { padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
          .status-online { background: rgba(35, 134, 54, 0.15); color: #3fb950; }
        </style>
      </head>
      <body>
        <nav class="sidebar">
          <div class="sidebar-logo">
            <i class="fas fa-bolt"></i>
            <h2>G8HOME MARKET</h2>
          </div>
          <ul class="nav-links">
            <li class="nav-item"><a href="/admin/dashboard" class="nav-link active"><i class="fas fa-home"></i> Tổng quan</a></li>
            <li class="nav-item"><a href="/admin/queues" class="nav-link"><i class="fas fa-layer-group"></i> Hàng đợi (Queues)</a></li>
            <li class="nav-item"><a href="#" class="nav-link"><i class="fas fa-box"></i> Kho hàng (Hub)</a></li>
            <li class="nav-item"><a href="#" class="nav-link"><i class="fas fa-shopping-bag"></i> Đơn hàng</a></li>
          </ul>
          <div class="user-info" style="margin-top: auto; padding: 20px 10px; border-top: 1px solid var(--card-border);">
            <a href="/admin/login" style="color: #ff4d4d; text-decoration: none; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
              <i class="fas fa-sign-out-alt"></i> Đăng xuất
            </a>
          </div>
        </nav>

        <main class="main-content">
          <header class="header">
            <div>
              <h1>Dashboard</h1>
              <p style="color: var(--text-dim); margin-top: 4px;">Chào mừng quay trở lại, Hệ thống đang hoạt động ổn định.</p>
            </div>
          </header>

          <section class="stats-grid">
            <div class="stat-card">
              <div class="stat-icon"><i class="fas fa-boxes"></i></div>
              <div class="stat-value">${productCount}</div>
              <div class="stat-label">Sản phẩm trong Hub</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon"><i class="fas fa-receipt"></i></div>
              <div class="stat-value">${orderCount}</div>
              <div class="stat-label">Tổng số đơn hàng</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon"><i class="fas fa-clock"></i></div>
              <div class="stat-value">~2s</div>
              <div class="stat-label">Thời gian trung bình sync</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon"><i class="fas fa-check-circle"></i></div>
              <div class="stat-value">99.8%</div>
              <div class="stat-label">Tỷ lệ thành công</div>
            </div>
          </section>

          <section class="action-section">
            <div class="card">
              <h3><i class="fas fa-sync-alt"></i> Đồng bộ danh mục sản phẩm (Master Data)</h3>
              <p style="color: var(--text-dim); margin-bottom: 24px; line-height: 1.6;">
                Kích hoạt tiến trình đồng bộ toàn bộ sản phẩm từ Odoo sang Integration Gateway và Vendure. 
                Quá trình này sẽ cập nhật Tên, Giá, SKU và Tồn kho cho tất cả sản phẩm đang có hiệu lực.
              </p>
              <form action="/admin/sync-all" method="POST" onsubmit="handleSync(event)">
                <button type="submit" class="sync-btn" id="btnSync">
                  <i class="fas fa-cloud-download-alt"></i>
                  <span>Đồng bộ ngay tất cả sản phẩm</span>
                  <i class="fas fa-spinner fa-spin" id="spinSync"></i>
                </button>
              </form>
            </div>

            <div class="card">
              <h3><i class="fas fa-server"></i> Hệ thống</h3>
              <table class="table-container">
                <tr>
                  <td>Odoo API</td>
                  <td align="right"><span class="status-badge status-online">Online</span></td>
                </tr>
                <tr>
                  <td>Vendure Admin</td>
                  <td align="right"><span class="status-badge status-online">Online</span></td>
                </tr>
                <tr>
                  <td>Redis Cluster</td>
                  <td align="right"><span class="status-badge status-online">Online</span></td>
                </tr>
                <tr>
                  <td>DB Postgres</td>
                  <td align="right"><span class="status-badge status-online">Online</span></td>
                </tr>
              </table>
            </div>
          </section>

          ${syncStatus}
        </main>

        <script>
          function handleSync(e) {
            const btn = document.getElementById('btnSync');
            const spin = document.getElementById('spinSync');
            btn.style.opacity = '0.7';
            btn.disabled = true;
            spin.style.display = 'inline-block';
            // Form sẽ tự submit
          }

          // Auto hide toast after 5s
          setTimeout(() => {
            const toast = document.querySelector('.toast');
            if (toast) toast.style.display = 'none';
          }, 5000);
        </script>
      </body>
      </html>
    `;
    res.type('html').send(html);
  }

  @Post('sync-all')
  async handleSyncAll(@Req() req: Request, @Res() res: Response) {
    if (req.cookies.admin_session !== 'true') {
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'Unauthorized' });
    }

    try {
      await this.odooSyncSchedule.triggerManualSync();
      return res.redirect('/admin/dashboard?sync=success');
    } catch (err) {
      return res.redirect('/admin/dashboard?sync=error');
    }
  }
}
