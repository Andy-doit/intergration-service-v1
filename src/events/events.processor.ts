import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { OrdersService } from '../orders/orders.service';
import { RedisService } from '../redis/redis.service';
import { OdooWebhookDto } from './dto/odoo-webhook.dto';
import { ODOO_EVENT_QUEUE } from './events.constants';



// ─── Mock external APIs ───────────────────────────────────────────────────────

/**
 * Mock: Gọi sang Vendure để cancel đơn hàng.
 */
async function cancelVendureOrder(vendureOrderId: string): Promise<void> {
  // TODO: Thay bằng HTTP call thực tế tới Vendure Admin API
  // await this.httpService.post(`${VENDURE_API_URL}/orders/${vendureOrderId}/cancel`)
  console.log(`[MOCK] cancelVendureOrder: vendureOrderId=${vendureOrderId}`);
}

/**
 * Mock: Void hoặc refund payment cho khách hàng.
 */
async function voidPayment(orderId: string): Promise<void> {
  // TODO: Thay bằng call thực tế tới Payment Gateway (Stripe, VNPay…)
  console.log(`[MOCK] voidPayment: orderId=${orderId}`);
}

/**
 * Mock: Gửi ZNS / SMS thông báo cho khách hàng.
 */
async function sendZnsSms(customerId: string, message: string): Promise<void> {
  // TODO: Thay bằng HTTP call tới Zalo ZNS hoặc SMS provider
  console.log(`[MOCK] sendZnsSms: customerId=${customerId} | message="${message}"`);
}

/**
 * Mock: Kích hoạt orchestrator (downstream workflow) sau khi đơn đã PACKED.
 */
async function triggerOrchestrator(order: Order): Promise<void> {
  // TODO: Thay bằng call thực tế tới orchestration layer (Temporal, Camunda…)
  console.log(`[MOCK] triggerOrchestrator: orderId=${order.id}, status=PACKED`);
}

// ─── Worker ───────────────────────────────────────────────────────────────────

@Processor(ODOO_EVENT_QUEUE)
export class EventsProcessor extends WorkerHost {
  private readonly logger = new Logger(EventsProcessor.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  async process(job: Job<OdooWebhookDto>): Promise<void> {
    const { order_id, event_type, odoo_picking_id } = job.data;

    this.logger.log(
      `[Worker] Processing job: name=${job.name}, order_id=${order_id}`,
    );

    switch (event_type) {
      // ── CONFIRMED → PICKING ─────────────────────────────────────────────────
      case 'picking.created':
      case 'picking.started':
        await this.ordersService.transitionTo(order_id, OrderStatus.PICKING, {
          odoo_picking_id: odoo_picking_id ?? null,
        });
        this.logger.log(`[Worker] Order ${order_id}: CONFIRMED → PICKING`);
        break;

      // ── PICKING → PICKED ────────────────────────────────────────────────────
      case 'picking.done':
        await this.ordersService.transitionTo(order_id, OrderStatus.PICKED);
        this.logger.log(`[Worker] Order ${order_id}: PICKING → PICKED`);
        break;

      // ── PICKED → PACKED (+ trigger orchestrator) ───────────────────────────
      case 'pack.done': {
        const packedOrder = await this.ordersService.transitionTo(
          order_id,
          OrderStatus.PACKED,
        );
        this.logger.log(`[Worker] Order ${order_id}: PICKED → PACKED`);
        // Kích hoạt downstream orchestration
        await triggerOrchestrator(packedOrder);
        break;
      }

      // ── Compensation (Giai đoạn 5) ─────────────────────────────────────────
      case 'stock.insufficient':
        await this.handleCompensation(job.data);
        break;

      default:
        this.logger.warn(
          `[Worker] Unknown event_type="${event_type}" for order_id=${order_id}. Skipped.`,
        );
    }
  }

  // ─── Giai đoạn 5: Compensation Transaction (6 bước) ───────────────────────

  /**
   * Chạy luồng bù trừ 6 bước khi Odoo báo `stock.insufficient`.
   *
   * Bước 1 → Cancel Vendure order
   * Bước 2 → Void / refund payment
   * Bước 3 → INCRBY kho: giải phóng soft-reserve cho từng item
   * Bước 4 → DEL tracking key: reserve:{product_id}:{order_draft_id}
   * Bước 5 → Gửi ZNS SMS thông báo hoàn tiền
   * Bước 6 → Ghi log incident ở mức Error/Warn
   */
  private async handleCompensation(event: OdooWebhookDto): Promise<void> {
    const { order_id, payload } = event;

    this.logger.warn(
      `[Compensation] stock.insufficient received for order_id=${order_id}. Starting 6-step compensation.`,
    );

    let order: Order;
    try {
      order = await this.ordersService.findById(order_id);
    } catch {
      this.logger.error(
        `[Compensation] Order not found: order_id=${order_id}. Aborting compensation.`,
      );
      return;
    }

    // ── Bước 1: Cancel Vendure order ─────────────────────────────────────────
    try {
      await cancelVendureOrder(order.vendure_order_id);
      this.logger.log(`[Compensation][1/6] Vendure order cancelled: ${order.vendure_order_id}`);
    } catch (err) {
      this.logger.error(
        `[Compensation][1/6] FAILED to cancel Vendure order ${order.vendure_order_id}`,
        (err as Error).stack,
      );
      // Không throw – tiếp tục bù trừ để tránh partial-failure
    }

    // ── Bước 2: Void / refund payment ────────────────────────────────────────
    try {
      await voidPayment(order_id);
      this.logger.log(`[Compensation][2/6] Payment voided/refunded for order: ${order_id}`);
    } catch (err) {
      this.logger.error(
        `[Compensation][2/6] FAILED to void payment for order ${order_id}`,
        (err as Error).stack,
      );
    }

    // ── Bước 3: INCRBY – Giải phóng kho cho từng item ────────────────────────
    try {
      for (const item of order.items) {
        const reserveKey = `reserve:${item.product_id}:${order_id}`;
        const reservedStr = await this.redisService.getClient().get(reserveKey);
        const reservedQty = reservedStr ? parseInt(reservedStr, 10) : item.qty;

        await this.redisService
          .getClient()
          .incrby(`stock:qty:${item.product_id}`, reservedQty);

        this.logger.log(
          `[Compensation][3/6] Released stock: product=${item.product_id}, qty=+${reservedQty}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[Compensation][3/6] FAILED to release stock for order ${order_id}`,
        (err as Error).stack,
      );
    }

    // ── Bước 4: DEL reserve tracking keys ────────────────────────────────────
    try {
      for (const item of order.items) {
        await this.redisService.deleteReserveTracking(item.product_id, order_id);
      }
      this.logger.log(
        `[Compensation][4/6] Reserve tracking keys deleted for order: ${order_id}`,
      );
    } catch (err) {
      this.logger.error(
        `[Compensation][4/6] FAILED to delete reserve tracking for order ${order_id}`,
        (err as Error).stack,
      );
    }

    // ── Bước 5: Gửi ZNS SMS thông báo hoàn tiền ──────────────────────────────
    try {
      const message =
        'Sản phẩm vừa hết hàng, chúng tôi sẽ hoàn tiền cho bạn trong 15 phút. Xin lỗi vì sự bất tiện này.';
      await sendZnsSms(order.customer_id, message);
      this.logger.log(
        `[Compensation][5/6] ZNS SMS sent to customer: ${order.customer_id}`,
      );
    } catch (err) {
      this.logger.error(
        `[Compensation][5/6] FAILED to send ZNS SMS for order ${order_id}`,
        (err as Error).stack,
      );
    }

    // ── Bước 6: Cancel order trong DB + ghi log incident ─────────────────────
    try {
      const insufficientProduct =
        (payload?.product_id as string) ?? 'unknown';
      const cancelReason = `stock.insufficient: product=${insufficientProduct}`;

      await this.ordersService.cancelOrder(order_id, cancelReason);

      this.logger.error(
        `[Compensation][6/6] INCIDENT LOG — Order ${order_id} cancelled due to stock.insufficient. ` +
          `customer=${order.customer_id}, ` +
          `product=${insufficientProduct}, ` +
          `payload=${JSON.stringify(payload ?? {})}`,
      );

      this.logger.warn(
        `[Compensation] All 6 steps completed for order_id=${order_id}. ` +
          `Order status → CANCELLED.`,
      );
    } catch (err) {
      this.logger.error(
        `[Compensation][6/6] FAILED to cancel order in DB ${order_id}`,
        (err as Error).stack,
      );
    }
  }
}
