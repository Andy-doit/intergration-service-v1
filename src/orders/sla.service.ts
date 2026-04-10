import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, In, Repository } from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Quét các đơn hàng sắp hoặc đã quá hạn SLA mỗi phút.
   * Lấy các đơn có sla_deadline < NOW() và trạng thái chưa hoàn tất.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkSlaBreaches() {
    this.logger.debug('SLA Monitor: Checking for breaches...');

    const breachedOrders = await this.orderRepo.find({
      where: {
        status: Not(In([OrderStatus.DELIVERED, OrderStatus.CANCELLED])),
        sla_deadline: LessThan(new Date()),
      },
    });

    if (breachedOrders.length === 0) {
      return;
    }

    this.logger.warn(
      `SLA Monitor: Found ${breachedOrders.length} breached orders!`,
    );

    for (const order of breachedOrders) {
      // Ghi log Audit Trail cho sự kiện quá hạn
      // Tránh ghi log lặp lại nếu đã log rồi (có thể check trong OrderLog nhưng ở đây log đơn giản)
      await this.ordersService.addLog(order.id, 'SLA_BREACH', {
        fromStatus: order.status,
        payload: {
          sla_deadline: order.sla_deadline,
          current_time: new Date(),
        },
      });

      this.logger.error(
        `[OPS ALERT] SLA BREACH: Order ${order.id} (Vendure: ${order.vendure_order_id}) ` +
          `is overdue. Deadline was ${order.sla_deadline?.toISOString()}`,
      );
    }
  }
}
