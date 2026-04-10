import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** DTO khi Odoo push stock sync lên service */
export class SyncStockDto {
  @IsString()
  @IsNotEmpty()
  product_id: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sku?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  qty_on_hand?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  // ── Odoo Native Fields (Hỗ trợ bắn Webhook trực tiếp từ UI Odoo) ──
  @IsOptional()
  id?: number;

  @IsOptional()
  default_code?: string; // Tương đương SKU

  @IsOptional()
  display_name?: string; // Tương đương Name

  @IsOptional()
  qty_available?: number; // Tương đương qty_on_hand

  @IsOptional()
  list_price?: number; // Tương đương price
}
