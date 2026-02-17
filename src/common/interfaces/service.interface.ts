export interface Service {
  id: string;
  name: string;
  description: string;
  price: number;
  maxPeople: number;
  duration: number;
  isActive: boolean;
  requiresDocuments: string[];
  imageUrls: string[];
  createdAt: Date;
}
