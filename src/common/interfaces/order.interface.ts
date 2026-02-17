import { OrderStatus } from '../enums/order-status.enum';

export interface OrderItem {
  serviceId: string;
  serviceName: string;
  quantity: number;
  price: number;
  scheduledDate: string;
  teamId: string;
  timeSlot: string;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  totalAmount: number;
  discountApplied: number;
  depositAmount: number;
  remainingAmount: number;
  status: OrderStatus;
  peopleCount: number;
  // Legacy fields (optional - only present on old orders)
  scheduledDate?: Date;
  teamId?: string;
  timeSlot?: string;
  createdAt: Date;
  updatedAt: Date;
}
