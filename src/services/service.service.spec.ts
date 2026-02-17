import { Test, TestingModule } from '@nestjs/testing';
import { ServicesService } from './services.service';
import { FirebaseService } from '../firebase/firebase.service';
import { NotFoundException } from '@nestjs/common';

describe('ServicesService', () => {
  let service: ServicesService;

  const mockFirestore = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    add: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
  };

  const mockFirebaseService = {
    getFirestore: jest.fn().mockReturnValue(mockFirestore),
    getStorage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServicesService,
        {
          provide: FirebaseService,
          useValue: mockFirebaseService,
        },
      ],
    }).compile();

    service = module.get<ServicesService>(ServicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a service', async () => {
      const createDto = {
        name: 'Test Service',
        description: 'Test Description',
        price: 100,
        maxPeople: 4,
        duration: 120,
        isActive: true,
        requiresDocuments: [],
        imageUrls: [],
      };

      const mockServiceRef = {
        id: 'test-id',
        get: jest.fn().mockResolvedValue({
          data: () => ({
            ...createDto,
            createdAt: { toDate: () => new Date() },
          }),
        }),
      };

      mockFirestore.add.mockResolvedValue(mockServiceRef);

      const result = await service.create(createDto);

      expect(result).toHaveProperty('id');
      expect(result.name).toBe(createDto.name);
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if service does not exist', async () => {
      mockFirestore.get.mockResolvedValue({
        exists: false,
      });

      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
