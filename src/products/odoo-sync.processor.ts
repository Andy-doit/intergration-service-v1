import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ProductsService } from './products.service';

@Processor('odoo-vendure-sync')
export class OdooSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(OdooSyncProcessor.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly productsService: ProductsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(
      `[Worker S2] Bắt đầu đồng bộ Master Data từ Odoo -> Gateway Hub (Job ID: ${job.id})`,
    );

    const baseUrl = process.env.ODOO_BASE_URL || 'http://localhost:8069';
    const db = process.env.ODOO_DB || 'Ten_DB_Odoo';
    const username = process.env.ODOO_USERNAME || 'admin';
    const password = process.env.ODOO_PASSWORD || 'admin';

    try {
      // 1. Authenticate (JSON-RPC common.login)
      this.logger.log(`[Worker S2] Authenticating with Odoo DB: ${db}...`);
      const authPayload = {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          service: 'common',
          method: 'login',
          args: [db, username, password],
        },
        id: Date.now(),
      };

      const authRes = await firstValueFrom(
        this.httpService.post(`${baseUrl}/jsonrpc`, authPayload),
      );
      const uid = authRes.data?.result;

      if (!uid) {
        throw new Error('Đăng nhập Odoo thất bại (Sai Database, User hoặc Pass)');
      }

      this.logger.log(`[Worker S2] Auth thành công. UID: ${uid}. Fetching Products...`);

      // 2. Search & Read Products (JSON-RPC object.execute_kw)
      const listPayload = {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          service: 'object',
          method: 'execute_kw',
          args: [
            db,
            uid,
            password,
            'product.product',
            'search_read',
            [[]], 
            {
              fields: [
                'id',
                'name',
                'default_code',
                'list_price',
                'lst_price',
                'qty_available',
                'uom_id',
              ],
              limit: 500,
            },
          ],
        },
        id: Date.now() + 1,
      };

      const dataRes = await firstValueFrom(
        this.httpService.post(`${baseUrl}/jsonrpc`, listPayload),
      );
      const productsFromOdoo = dataRes.data?.result || [];

      if (productsFromOdoo.length === 0) {
        this.logger.warn(`⚠️ Odoo trả về 0 sản phẩm. Kết thúc tiến trình S2.`);
        return;
      }

      this.logger.log(
        `✅ Tìm thấy ${productsFromOdoo.length} sản phẩm. Đang cập nhật sang Gateway Hub...`,
      );

      let successCount = 0;
      let failCount = 0;

      for (const prod of productsFromOdoo) {
        try {
          // Lưu vào Gateway Hub (PostgreSQL & Redis)
          await this.productsService.syncStock({
            product_id: `odoo.product.product:${prod.id}`,
            id: prod.id,
            name: prod.name,
            default_code: prod.default_code,
            lst_price: prod.lst_price,
            list_price: prod.list_price,
            qty_available: prod.qty_available,
            unit: Array.isArray(prod.uom_id) ? prod.uom_id[1] : 'cái',
          });
          successCount++;
        } catch (e: any) {
          this.logger.error(`❌ Lỗi đồng bộ Hub cho SP [${prod.name}]: ${e.message}`);
          failCount++;
        }
      }

      this.logger.log(
        `[Worker S2] Hoàn tất cập nhật Hub. Thành công: ${successCount}, Thất bại: ${failCount}.`,
      );
      this.logger.log(`💡 Lưu ý: Dữ liệu đã dừng lại ở Gateway, chưa bắn sang Vendure theo yêu cầu.`);
    } catch (error: any) {
      this.logger.error(
        `[Worker S2] Lỗi hệ thống khi đồng bộ Hub: ${error.message}`,
      );
      throw error;
    }
  }
}
