import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './product.entity';

export enum InventoryChangeType {
  /** Sync từ Odoo — thiết lập lại qty tuyệt đối */
  SYNC = 'SYNC',
  /** Soft-reserve khi đặt hàng (DECRBY) */
  RESERVE = 'RESERVE',
  /** Giải phóng khi Odoo reject (INCRBY) */
  RELEASE = 'RELEASE',
  /** Điều chỉnh thủ công */
  ADJUSTMENT = 'ADJUSTMENT',
}

@Entity({ name: 'inventory_logs' })
@Index(['product_id', 'created_at'])
export class Inventory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  product_id: string;

  @ManyToOne(() => Product, (p) => p.inventory_logs, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  product: Product;

  @Column({
    type: 'enum',
    enum: InventoryChangeType,
  })
  change_type: InventoryChangeType;

  /** Số lượng thay đổi (dương = tăng, âm = giảm) */
  @Column({ type: 'int' })
  delta: number;

  /** Số lượng tồn kho sau khi thay đổi (snapshot tại thời điểm ghi) */
  @Column({ type: 'int' })
  qty_after: number;

  /** ID đơn hàng liên quan (nếu có) */
  @Column({ type: 'varchar', nullable: true })
  order_id: string | null;

  /** Ghi chú thêm */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  created_at: Date;
}
