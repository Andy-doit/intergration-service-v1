import {
  BadRequestException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { RedisService } from '../redis/redis.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderLog } from './entities/order-log.entity';

/** Tên BullMQ queue chính giao tiếp với Odoo */
export const ODOO_CREATE_PICKING_QUEUE = '🚀 Gửi Đơn qua Odoo (Create Picking)';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,

    @InjectRepository(OrderLog)
    private readonly orderLogRepo: Repository<OrderLog>,

    @InjectQueue(ODOO_CREATE_PICKING_QUEUE)
    private readonly odooQueue: Queue,

    private readonly redisService: RedisService,
  ) {}

  /**
   * Ghi log sự kiện cho đơn hàng (Audit Trail)
   */
  async addLog(
    orderId: string,
    eventType: string,
    data: {
      fromStatus?: OrderStatus | null;
      toStatus?: OrderStatus | null;
      payload?: any;
    },
  ): Promise<OrderLog> {
    const log = this.orderLogRepo.create({
      order_id: orderId,
      event_type: eventType,
      from_status: data.fromStatus ?? null,
      to_status: data.toStatus ?? null,
      payload: data.payload ?? null,
    });
    return this.orderLogRepo.save(log);
  }

  // ─── Create Order (S4 – Lượt đi) ─────────────────────────────────────────────

  /**
   * Nhận đơn hàng đã được confirm từ Storefront.
   * Luồng:
   *  1. Kiểm tra đơn trùng (idempotency theo vendure_order_id).
   *  2. Soft-reserve kho qua Redis (DECRBY).
   *     Nếu bất kỳ item nào còn lại < 0 → rollback và throw.
   *  3. Lưu Order vào DB với trạng thái CONFIRMED.
   *  4. Đẩy job vào BullMQ queue `odoo.create_picking`.
   */
  async createOrder(dto: CreateOrderDto): Promise<Order> {
    // ── 1. Idempotency check (chống tạo đơn trùng) ───────────────────────────
    const existing = await this.orderRepo.findOne({
      where: { vendure_order_id: dto.vendure_order_id },
    });
    if (existing) {
      this.logger.warn(
        `Duplicate order detected: vendure_order_id=${dto.vendure_order_id}`,
      );
      return existing;
    }

    // ── 2. Soft-Reserve cho từng sản phẩm ────────────────────────────────────
    const reservedItems: Array<{ productId: string }> = [];

    try {
      for (const item of dto.items) {
        const remaining = await this.redisService.softReserve(
          item.product_id,
          dto.vendure_order_id,
          item.qty,
        );

        reservedItems.push({ productId: item.product_id });

        if (remaining < 0) {
          throw new UnprocessableEntityException(
            `Insufficient stock for product ${item.product_id}. ` +
              `Requested: ${item.qty}, remaining after reserve: ${remaining}`,
          );
        }
      }
    } catch (err) {
      // Rollback tất cả reserve đã thực hiện trước khi throw
      this.logger.warn(
        `Soft-reserve failed, rolling back ${reservedItems.length} items for order ${dto.vendure_order_id}`,
      );
      await this.redisService.releaseReserveMany(
        reservedItems,
        dto.vendure_order_id,
      );
      throw err;
    }

    // ── 3. Lưu Order vào DB với trạng thái CONFIRMED ──────────────────────────
    const order = this.orderRepo.create({
      vendure_order_id: dto.vendure_order_id,
      customer_id: dto.customer_id,
      items: dto.items,
      delivery_address: dto.delivery_address,
      priority: dto.priority ?? 1,
      sla_deadline: dto.sla_deadline ? new Date(dto.sla_deadline) : null,
      status: OrderStatus.CONFIRMED,
    });

    const savedOrder = await this.orderRepo.save(order);
    this.logger.log(
      `Order saved: id=${savedOrder.id}, status=CONFIRMED, vendure_order_id=${dto.vendure_order_id}`,
    );

    // Audit Log: Created
    await this.addLog(savedOrder.id, 'ORDER_CREATED', {
      toStatus: OrderStatus.CONFIRMED,
      payload: { vendure_order_id: dto.vendure_order_id },
    });

    // ── 4. Đẩy job vào BullMQ ────────────────────────────────────────────────
    const jobPayload = {
      order_id: savedOrder.id,
      vendure_order_id: savedOrder.vendure_order_id,
      customer_id: savedOrder.customer_id,
      items: savedOrder.items,
      delivery_address: savedOrder.delivery_address,
      priority: savedOrder.priority,
      sla_deadline: savedOrder.sla_deadline?.toISOString() ?? null,
    };

    await this.odooQueue.add('create_picking', jobPayload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    });

    this.logger.log(
      `Job pushed to queue "${ODOO_CREATE_PICKING_QUEUE}": order_id=${savedOrder.id}`,
    );

    return savedOrder;
  }

  // ─── State Machine Transitions ─────────────────────────────────────────────

  async transitionTo(
    orderId: string,
    newStatus: OrderStatus,
    meta?: Partial<Order>,
  ): Promise<Order> {
    const order = await this.orderRepo.findOneOrFail({
      where: { id: orderId },
    });

    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.DRAFT]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
      [OrderStatus.CONFIRMED]: [OrderStatus.PICKING, OrderStatus.CANCELLED],
      [OrderStatus.PICKING]: [OrderStatus.PICKED, OrderStatus.CANCELLED],
      [OrderStatus.PICKED]: [OrderStatus.PACKED, OrderStatus.CANCELLED],
      [OrderStatus.PACKED]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
      [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      [OrderStatus.DELIVERED]: [],
      [OrderStatus.CANCELLED]: [],
    };

    if (!allowedTransitions[order.status].includes(newStatus)) {
      throw new BadRequestException(
        `Invalid transition: ${order.status} → ${newStatus} for order ${orderId}`,
      );
    }

    Object.assign(order, { status: newStatus, ...meta });
    const oldStatus = order.status;
    const updated = await this.orderRepo.save(order);
    this.logger.log(`Order ${orderId}: ${oldStatus} → ${newStatus}`);

    // Audit Log: State Transition
    await this.addLog(orderId, 'STATE_TRANSITION', {
      fromStatus: oldStatus,
      toStatus: newStatus,
      payload: meta,
    });

    return updated;
  }

  async findById(orderId: string): Promise<Order> {
    return this.orderRepo.findOneOrFail({
      where: [{ id: orderId }, { vendure_order_id: orderId }],
    });
  }

  async cancelOrder(orderId: string, reason: string): Promise<Order> {
    return this.transitionTo(orderId, OrderStatus.CANCELLED, {
      cancel_reason: reason,
    });
  }
}
