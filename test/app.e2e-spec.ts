import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('ServicesController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/services (GET)', () => {
    it('should return array of services', () => {
      return request(app.getHttpServer())
        .get('/api/services')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('should filter active services only', () => {
      return request(app.getHttpServer())
        .get('/api/services?activeOnly=true')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  describe('/api/services (POST)', () => {
    it('should fail without authentication', () => {
      const createDto = {
        name: 'Unauthorized Service',
        description: 'Should fail',
        price: 100,
        maxPeople: 4,
        duration: 120,
      };

      return request(app.getHttpServer())
        .post('/api/services')
        .send(createDto)
        .expect(401);
    });
  });

  describe('/api/services/:id (GET)', () => {
    it('should return 404 for non-existent service', () => {
      return request(app.getHttpServer())
        .get('/api/services/non-existent-id')
        .expect(404);
    });
  });
});
