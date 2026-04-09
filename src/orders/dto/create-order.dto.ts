import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  product_id: string;

  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @IsPositive()
  qty: number;

  @IsNumber()
  @IsPositive()
  unit_price: number;
}

export class CreateOrderDto {
  /** ID đơn hàng gốc từ Vendure/Storefront */
  @IsString()
  @IsNotEmpty()
  vendure_order_id: string;

  /** ID khách hàng */
  @IsString()
  @IsNotEmpty()
  customer_id: string;

  /** Danh sách sản phẩm */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  /** Địa chỉ giao hàng */
  @IsString()
  @IsNotEmpty()
  delivery_address: string;

  /**
   * Độ ưu tiên (1 = thường, 2 = ưu tiên, 3 = khẩn cấp).
   * Map với trường `priority` bên Odoo picking.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  priority?: number;

  /**
   * SLA deadline (ISO 8601 string).
   * Dùng để Odoo hoàn thành picking đúng hạn.
   */
  @IsOptional()
  @IsDateString()
  sla_deadline?: string;
}
