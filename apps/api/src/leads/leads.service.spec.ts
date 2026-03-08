import { Test, TestingModule } from '@nestjs/testing';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { LegalCasesService } from '../legal-cases/legal-cases.service';


describe('LeadsService', () => {
  let service: LeadsService;
  let prisma: any;

  const mockPrisma: any = {
    lead: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((input: any): any => {
      if (typeof input === 'function') return input(mockPrisma);
      return Promise.all(input);
    }),
  };

  const mockLegalCasesService = {
    findByLeadId: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LegalCasesService, useValue: mockLegalCasesService },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should normalize phone with 13 digits (remove 9th digit)', async () => {
      const mockLead = { id: '1', name: 'Test', phone: '558299130127' };
      mockPrisma.lead.create.mockResolvedValue(mockLead);

      await service.create({ name: 'Test', phone: '5582999130127' });

      expect(mockPrisma.lead.create).toHaveBeenCalledWith({
        data: { name: 'Test', phone: '558299130127' },
      });
    });

    it('should keep phone with 12 digits unchanged', async () => {
      const mockLead = { id: '1', name: 'Test', phone: '558299130127' };
      mockPrisma.lead.create.mockResolvedValue(mockLead);

      await service.create({ name: 'Test', phone: '558299130127' });

      expect(mockPrisma.lead.create).toHaveBeenCalledWith({
        data: { name: 'Test', phone: '558299130127' },
      });
    });
  });

  describe('findOne', () => {
    it('should return lead when found', async () => {
      const mockLead = { id: '1', name: 'Test', phone: '558299130127' };
      mockPrisma.lead.findUnique.mockResolvedValue(mockLead);

      const result = await service.findOne('1');
      expect(result).toEqual(mockLead);
    });

    it('should return null when lead not found', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(null);

      const result = await service.findOne('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all leads without pagination', async () => {
      const mockLeads = [
        { id: '1', name: 'A', phone: '551', conversations: [], _count: { conversations: 0 } },
        { id: '2', name: 'B', phone: '552', conversations: [], _count: { conversations: 0 } },
      ];
      mockPrisma.lead.findMany.mockResolvedValue(mockLeads);

      const result = await service.findAll();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return paginated result when page and limit are provided', async () => {
      const mockLeads = [
        { id: '1', name: 'A', phone: '551', conversations: [], _count: { conversations: 0 } },
      ];
      mockPrisma.lead.findMany.mockResolvedValue(mockLeads);
      mockPrisma.lead.count.mockResolvedValue(10);

      const result = await service.findAll(undefined, undefined, 1, 5);
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
    });
  });

  describe('checkPhone', () => {
    it('should return exists=true when phone is found', async () => {
      const mockLead = { id: '1', name: 'Test', phone: '558299130127' };
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);

      const result = await service.checkPhone('5582999130127');
      expect(result.exists).toBe(true);
      expect(result.lead).toEqual(mockLead);
    });

    it('should return exists=false when phone not found', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);

      const result = await service.checkPhone('5582999999999');
      expect(result.exists).toBe(false);
    });
  });
});
