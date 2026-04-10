import { IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * DTO nhận dữ liệu thô từ "Send Webhook Notification" của Odoo.
 * Bạn cần đảm bảo đã cấu hình các trường sau trong Odoo Webhook Fields:
 * - display_name
 * - origin (Source Document)
 * - state (Status)
 */
export class OdooRawWebhookDto {
  @IsNumber()
  id: number;

  @IsString()
  display_name: string;

  @IsString()
  @IsOptional()
  origin?: string; // Source Document

  @IsString()
  @IsOptional()
  state?: string; // Status

  @IsString()
  @IsOptional()
  picking_type_code?: string;

  // Cho phép nhận các trường thô khác tùy chọn
  [key: string]: any;
}
