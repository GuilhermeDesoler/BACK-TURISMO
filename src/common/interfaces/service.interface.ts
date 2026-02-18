export interface Service {
  id: string;
  name: string;
  nameEn?: string;
  nameEs?: string;
  description: string;
  descriptionEn?: string;
  descriptionEs?: string;
  price: number;
  maxPeople: number;
  duration: number;
  isActive: boolean;
  requiresDocuments: string[];
  imageUrls: string[];
  createdAt: Date;
}
