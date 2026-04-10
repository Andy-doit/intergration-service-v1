import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Req,
  HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { OdooSyncSchedule } from '../products/odoo-sync.schedule';

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
          body { background: #0f111a; min-height: 100vh; display: flex; align-items: center; justify-content: center; color: #fff; }
          .login-container { background: #1a1d27; padding: 48px; border-radius: 16px; width: 100%; max-width: 420px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.05); }
          .logo { text-align: center; margin-bottom: 32px; }
          .logo h1 { font-size: 24px; font-weight: 700; background: linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
          .logo p { color: #8b949e; font-size: 14px; }
          .form-group { margin-bottom: 20px; }
          .form-group label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 8px; color: #c9d1d9; }
          .form-group input { width: 100%; padding: 12px 16px; background: #0f111a; border: 1px solid #30363d; border-radius: 8px; color: #fff; font-size: 14px; transition: all 0.2s ease; }
          .form-group input:focus { outline: none; border-color: #FF8E53; box-shadow: 0 0 0 3px rgba(255, 142, 83, 0.15); }
          button { width: 100%; padding: 14px; background: linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%); border: none; border-radius: 8px; color: #fff; font-weight: 600; font-size: 15px; cursor: pointer; transition: opacity 0.2s ease; margin-top: 8px; }
          button:hover { opacity: 0.9; }
          .alert { background: rgba(220, 53, 69, 0.1); color: #ff7b72; padding: 12px; border-radius: 8px; font-size: 13px; margin-bottom: 20px; border: 1px solid rgba(220, 53, 69, 0.2); text-align: center; }
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
    if (req.cookies.admin_session !== 'true') return res.redirect('/admin/login');

    const [products, orders, productCount, orderCount] = await Promise.all([
      this.productRepo.find({ order: { updated_at: 'DESC' }, take: 50 }),
      this.orderRepo.find({ order: { updated_at: 'DESC' }, take: 50 }),
      this.productRepo.count().catch(() => 0),
      this.orderRepo.count().catch(() => 0),
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
        <title>G8HOME - Dashboard & Portfolio</title>
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
          body { background: var(--bg-primary); color: var(--text-main); overflow: hidden; display: flex; height: 100vh; }

          /* Sidebar */
          .sidebar { width: var(--sidebar-width); height: 100vh; background: var(--bg-secondary); border-right: 1px solid var(--card-border); padding: 32px 20px; display: flex; flex-direction: column; z-index: 1000; }
          .sidebar-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 48px; padding-left: 10px; }
          .sidebar-logo i { font-size: 24px; background: var(--accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          .sidebar-logo h2 { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; }
          
          .nav-links { list-style: none; flex: 1; }
          .nav-item { margin-bottom: 8px; }
          .nav-link { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 10px; color: var(--text-dim); text-decoration: none; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; }
          .nav-link:hover, .nav-link.active { background: rgba(255, 126, 95, 0.1); color: var(--accent); }
          .nav-link i { font-size: 18px; width: 24px; text-align: center; }

          /* Layout */
          .main-view-container { flex: 1; height: 100vh; overflow: hidden; position: relative; }
          .tab-content { width: 100%; height: 100%; display: none; overflow-y: auto; }
          .tab-content.active { display: block; }
          .content-padding { padding: 48px; }
          .full-height-tab { height: 100%; overflow: hidden !important; padding: 0 !important; }
          .queue-container { width: 100%; height: 100%; border: none; background: #000; }

          /* Stats */
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
          .header h1 { font-size: 28px; font-weight: 700; letter-spacing: -1px; }

          .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; margin-bottom: 40px; }
          .stat-card { background: var(--bg-secondary); padding: 24px; border-radius: 20px; border: 1px solid var(--card-border); transition: transform 0.3s ease; }
          .stat-icon { width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 126, 95, 0.1); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 18px; margin-bottom: 16px; }
          .stat-value { font-size: 32px; font-weight: 700; }
          .stat-label { color: var(--text-dim); font-size: 14px; margin-top: 4px; }

          /* Tables */
          .card { background: var(--bg-secondary); padding: 32px; border-radius: 24px; border: 1px solid var(--card-border); margin-bottom: 24px; }
          .card h3 { margin-bottom: 24px; font-size: 18px; display: flex; align-items: center; gap: 10px; }
          
          .custom-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          .custom-table th { text-align: left; color: var(--text-dim); font-size: 12px; padding: 12px; border-bottom: 2px solid var(--card-border); text-transform: uppercase; letter-spacing: 0.5px; }
          .custom-table td { padding: 16px 12px; font-size: 14px; border-bottom: 1px solid var(--card-border); color: #c9d1d9; }
          .custom-table tr:hover { background: rgba(255, 255, 255, 0.02); }

          /* Badges */
          .badge { padding: 6px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
          .badge-blue { background: rgba(56, 139, 253, 0.15); color: #58a6ff; }
          .badge-orange { background: rgba(210, 153, 34, 0.15); color: #d29922; }
          .badge-green { background: rgba(35, 134, 54, 0.15); color: #3fb950; }
          .badge-red { background: rgba(248, 81, 73, 0.15); color: #f85149; }

          /* UI Elements */
          .sync-btn { background: var(--accent-gradient); color: #fff; border: none; padding: 14px 20px; border-radius: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: all 0.3s; }
          .sync-btn:hover { opacity: 0.9; transform: translateY(-2px); }
          .info-btn { background: rgba(255,255,255,0.05); border: 1px solid var(--card-border); color: var(--text-dim); padding: 8px; border-radius: 8px; cursor: pointer; transition: 0.2s; }
          .info-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

          /* Modal */
          .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: none; align-items: center; justify-content: center; z-index: 2000; padding: 20px; backdrop-filter: blur(4px); }
          .modal-content { background: var(--bg-secondary); width: 100%; max-width: 500px; border-radius: 24px; border: 1px solid var(--card-border); padding: 40px; position: relative; box-shadow: 0 30px 60px rgba(0,0,0,0.5); }
          .modal-close { position: absolute; top: 20px; right: 20px; font-size: 24px; color: var(--text-dim); cursor: pointer; }
          .detail-row { display: flex; justify-content: space-between; padding: 16px 0; border-bottom: 1px solid var(--card-border); }
          .detail-row span:first-child { color: var(--text-dim); font-size: 14px; }
          .detail-row span:last-child { font-weight: 600; font-size: 14px; color: var(--text-main); }

          .toast { position: fixed; bottom: 30px; right: 30px; background: #238636; color: #fff; padding: 16px 24px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-weight: 500; display: none; animation: slideIn 0.3s ease-out; z-index: 1000; }
          @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        </style>
      </head>
      <body>
        <nav class="sidebar">
          <div class="sidebar-logo"><i class="fas fa-bolt"></i><h2>G8HOME HUB</h2></div>
          <ul class="nav-links">
            <li class="nav-item"><a onclick="switchTab('overview')" id="nav-overview" class="nav-link active"><i class="fas fa-chart-pie"></i> Tổng quan</a></li>
            <li class="nav-item"><a onclick="switchTab('products')" id="nav-products" class="nav-link"><i class="fas fa-box"></i> Sản phẩm (Hub)</a></li>
            <li class="nav-item"><a onclick="switchTab('orders')" id="nav-orders" class="nav-link"><i class="fas fa-shopping-cart"></i> Đơn hàng</a></li>
            <li class="nav-item"><a onclick="switchTab('queues')" id="nav-queues" class="nav-link"><i class="fas fa-microchip"></i> Hàng đợi</a></li>
          </ul>
          <div style="margin-top:auto; padding-top:20px; border-top:1px solid var(--card-border);">
            <a href="/admin/login" style="color:#f85149; text-decoration:none; font-size:14px; font-weight:600; display:flex; align-items:center; gap:8px;"><i class="fas fa-sign-out-alt"></i> Đăng xuất</a>
          </div>
        </nav>

        <div class="main-view-container">
          <!-- TAB: OVERVIEW -->
          <div id="view-overview" class="tab-content content-padding active">
            <header class="header"><h1>Điều hành Hệ thống</h1></header>
            <div class="stats-grid">
              <div class="stat-card"><div class="stat-icon"><i class="fas fa-boxes"></i></div><div class="stat-value">${productCount}</div><div class="stat-label">Sản phẩm hiện có</div></div>
              <div class="stat-card"><div class="stat-icon"><i class="fas fa-receipt"></i></div><div class="stat-value">${orderCount}</div><div class="stat-label">Đơn hàng đã xử lý</div></div>
              <div class="stat-card"><div class="stat-icon"><i class="fas fa-sync"></i></div><div class="stat-value">60s</div><div class="stat-label">Cache Interval</div></div>
            </div>
            <div class="card">
              <h3><i class="fas fa-cloud-download-alt"></i> Đồng bộ Master Data</h3>
              <p style="color:var(--text-dim); margin-bottom:24px;">Cập nhật toàn bộ danh mục từ Odoo. Thao tác này sẽ làm mới SKU, Giá và Tồn kho.</p>
              <form action="/admin/sync-all" method="POST" onsubmit="handleSync(event)">
                <button type="submit" class="sync-btn" id="btnSync"><i class="fas fa-play"></i><span>Bắt đầu đồng bộ ngay</span><i class="fas fa-spinner fa-spin" id="spinSync" style="display:none"></i></button>
              </form>
            </div>
          </div>

          <!-- TAB: PRODUCTS -->
          <div id="view-products" class="tab-content content-padding">
            <header class="header"><h1>Danh mục Sản phẩm</h1></header>
            <div class="card">
              <table class="custom-table">
                <thead><tr><th>SKU</th><th>Tên sản phẩm</th><th>Đơn giá</th><th>Sync Gần nhất</th><th></th></tr></thead>
                <tbody>
                  ${products.map(p => `
                    <tr>
                      <td><code>${p.sku}</code></td>
                      <td><b>${p.name}</b></td>
                      <td>${(Number(p.price)).toLocaleString()} đ</td>
                      <td>${p.last_synced_at ? new Date(p.last_synced_at).toLocaleString('vi-VN') : '---'}</td>
                      <td align="right"><button class="info-btn" onclick='showDetails(${JSON.stringify(p).replace(/'/g, "&apos;")})'><i class="fas fa-eye"></i></button></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- TAB: ORDERS -->
          <div id="view-orders" class="tab-content content-padding">
            <header class="header"><h1>Lịch sử Đơn hàng</h1></header>
            <div class="card">
              <table class="custom-table">
                <thead><tr><th>Order ID</th><th>Vendure ID</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
                <tbody>
                  ${orders.map(o => `
                    <tr>
                      <td><b>#${o.id}</b></td>
                      <td>${o.vendure_order_id || '---'}</td>
                      <td><span class="badge ${getStatusClass(o.status)}">${o.status}</span></td>
                      <td>${new Date(o.updated_at).toLocaleString('vi-VN')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- TAB: QUEUES -->
          <div id="view-queues" class="tab-content full-height-tab"><iframe src="/admin/_internal_queues_monitor_" class="queue-container"></iframe></div>
          
          ${syncStatus}
        </div>

        <!-- MODAL -->
        <div id="detailModal" class="modal-overlay" onclick="closeModal(event)">
          <div class="modal-content" onclick="event.stopPropagation()">
            <span class="modal-close" onclick="closeModal()">&times;</span>
            <h2 id="modalTitle" style="margin-bottom:24px; font-size:24px; color:var(--accent)">Chi tiết sản phẩm</h2>
            <div id="modalBody"></div>
          </div>
        </div>

        <script>
          function switchTab(t) {
            document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
            document.getElementById('nav-'+t).classList.add('active');
            document.querySelectorAll('.tab-content').forEach(v => v.classList.remove('active'));
            document.getElementById('view-'+t).classList.add('active');
            window.location.hash = t;
          }
          function handleSync() { document.getElementById('spinSync').style.display='inline-block'; document.getElementById('btnSync').disabled=true; }
          function showDetails(p) {
            document.getElementById('modalTitle').innerText = p.name;
            document.getElementById('modalBody').innerHTML = \`
              <div class="detail-row"><span>ID Hệ thống</span><span>\${p.id}</span></div>
              <div class="detail-row"><span>Mã SKU</span><span>\${p.sku}</span></div>
              <div class="detail-row"><span>Phân loại</span><span>\${p.category || 'N/A'}</span></div>
              <div class="detail-row"><span>Đơn giá</span><span>\${Number(p.price).toLocaleString()} đ</span></div>
              <div class="detail-row"><span>Đơn vị tính</span><span>\${p.unit}</span></div>
              <div class="detail-row"><span>Trạng thái</span><span>\${p.is_active ? 'Đang kinh doanh' : 'Ngừng bán'}</span></div>
              <div class="detail-row"><span>Ngày tạo</span><span>\${new Date(p.created_at).toLocaleString()}</span></div>
            \`;
            document.getElementById('detailModal').style.display='flex';
          }
          function closeModal() { document.getElementById('detailModal').style.display='none'; }
          window.onload = () => { if(window.location.hash) switchTab(window.location.hash.substring(1)); }
        </script>
      </body>
      </html>
    `;
    res.type('html').send(html);
  }

  @Post('sync-all')
  async handleSyncAll(@Req() req: Request, @Res() res: Response) {
    if (req.cookies.admin_session !== 'true') return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'Unauthorized' });
    try { await this.odooSyncSchedule.triggerManualSync(); return res.redirect('/admin/dashboard?sync=success'); }
    catch (err) { return res.redirect('/admin/dashboard?sync=error'); }
  }
}

function getStatusClass(s: string) {
  if (s.includes('SHIPPED') || s.includes('DONE')) return 'badge-green';
  if (s.includes('PICK') || s.includes('PACK')) return 'badge-orange';
  if (s.includes('CANCEL')) return 'badge-red';
  return 'badge-blue';
}
