import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Inventory } from './inventory.entity';

@Entity({ name: 'products' })
export class Product {
  /** product_id từ Odoo (e.g. "odoo:product.product:42") */
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  sku: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  category: string | null;

  /** Giá bán (VND) */
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  price: number;

  /** Đơn vị tính: cái, hộp, kg… */
  @Column({ type: 'varchar', default: 'cái' })
  unit: string;

  /** Trạng thái: true = đang bán */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  /** Thời điểm sync cuối từ Odoo */
  @Column({ type: 'timestamptz', nullable: true })
  last_synced_at: Date | null;

  @OneToMany(() => Inventory, (inv) => inv.product)
  inventory_logs: Inventory[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
