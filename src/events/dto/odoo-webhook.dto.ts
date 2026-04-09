import { IsIn, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Danh sách event type hợp lệ từ Odoo webhook.
 */
export const ODOO_EVENT_TYPES = [
  'picking.created',
  'picking.started',
  'picking.done',
  'pack.done',
  'stock.insufficient',
] as const;

export type OdooEventType = (typeof ODOO_EVENT_TYPES)[number];

export class OdooWebhookDto {
  /** ID đơn hàng nội bộ (order.id trong DB của chúng ta) */
  @IsString()
  @IsNotEmpty()
  order_id: string;

  /** Loại sự kiện từ Odoo */
  @IsString()
  @IsIn(ODOO_EVENT_TYPES)
  event_type: OdooEventType;

  /** Unix timestamp (giây) của sự kiện – dùng để tạo idempotency key */
  @IsNumber()
  timestamp: number;

  /** ID picking bên Odoo (có trong hầu hết events) */
  @IsOptional()
  @IsString()
  odoo_picking_id?: string;

  /** Payload extra (lý do lỗi, thông tin sản phẩm thiếu…) */
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
