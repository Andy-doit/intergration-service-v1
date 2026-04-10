import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { Order, OrderStatus } from './order.entity';

@Entity({ name: 'order_logs' })
export class OrderLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    nullable: true,
  })
  from_status: OrderStatus | null;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    nullable: true,
  })
  to_status: OrderStatus | null;

  /** Loại sự kiện (e.g. 'STATE_TRANSITION', 'ODOO_WEBHOOK', 'SLA_BREACH', 'COMPENSATION') */
  @Column({ type: 'varchar' })
  event_type: string;

  /** Dữ liệu chi tiết (e.g. raw payload từ Odoo) */
  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  @CreateDateColumn()
  created_at: Date;
}
