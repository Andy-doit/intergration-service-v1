import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  PICKING = 'PICKING',
  PICKED = 'PICKED',
  PACKED = 'PACKED',
  CANCELLED = 'CANCELLED',
}

export interface OrderItem {
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
}

@Entity({ name: 'orders' })
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ID đơn hàng gốc từ Storefront/Vendure */
  @Column({ type: 'varchar', unique: true })
  vendure_order_id: string;

  /** ID picking tương ứng bên Odoo (sau khi Odoo tạo picking) */
  @Column({ type: 'varchar', nullable: true })
  odoo_picking_id: string | null;

  @Column({ type: 'varchar' })
  customer_id: string;

  /** Danh sách sản phẩm (lưu dạng JSONB) */
  @Column({ type: 'jsonb' })
  items: OrderItem[];

  @Column({ type: 'text' })
  delivery_address: string;

  /** Độ ưu tiên (1 = thường, 3 = cao) */
  @Column({ type: 'int', default: 1 })
  priority: number;

  /** Deadline SLA (ISO string) */
  @Column({ type: 'timestamptz', nullable: true })
  sla_deadline: Date | null;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.DRAFT,
  })
  status: OrderStatus;

  /** Ghi chú / lý do cancel nếu có */
  @Column({ type: 'text', nullable: true })
  cancel_reason: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
