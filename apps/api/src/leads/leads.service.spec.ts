import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { LegalCasesService } from '../legal-cases/legal-cases.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { AutomationsService } from '../automations/automations.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';


describe('LeadsService', () => {
  let service: LeadsService;
  let prisma: any;

  const mockPrisma: any = {
    lead: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    leadNote: {
      create: jest.fn(),
    },
    $transaction: jest.fn((input: any): any => {
      if (typeof input === 'function') return input(mockPrisma);
      return Promise.all(input);
    }),
  };

  const mockLegalCasesService = {
    findByLeadId: jest.fn(),
  };

  const mockChatGateway = {
    emitConversationsUpdate: jest.fn(),
    emitNewLeadNotification: jest.fn().mockResolvedValue(undefined),
  };

  const mockAutomationsService = {
    onNewLead: jest.fn().mockResolvedValue(undefined),
  };

  const mockGoogleDriveService = {};
  const mockModuleRef = { get: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LegalCasesService, useValue: mockLegalCasesService },
        { provide: ChatGateway, useValue: mockChatGateway },
        { provide: AutomationsService, useValue: mockAutomationsService },
        { provide: GoogleDriveService, useValue: mockGoogleDriveService },
        { provide: ModuleRef, useValue: mockModuleRef },
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

  describe('updatePhone', () => {
    const oldPhone = '558299130127';
    const newCanonical = '558299988877';

    it('rejects invalid BR phone with BadRequestException', async () => {
      await expect(
        service.updatePhone('lead-1', '12345', undefined, 'admin-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when lead does not exist', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(null);
      await expect(
        service.updatePhone('missing', '82999988877', undefined, 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns early (no-op) when canonical phone equals current', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', tenant_id: null, phone: oldPhone, name: 'X' });
      mockPrisma.lead.findUniqueOrThrow.mockResolvedValue({ id: 'lead-1', phone: oldPhone });
      // Input em formato nao-canonico (13 digitos com 9) que canoniza pro mesmo valor.
      const result = await service.updatePhone('lead-1', '5582999130127', undefined, 'admin-1');
      expect(result.phone).toBe(oldPhone);
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
      expect(mockPrisma.lead.findFirst).not.toHaveBeenCalled();
    });

    it('throws ConflictException with conflict payload when number exists in another lead', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', tenant_id: null, phone: oldPhone, name: 'X' });
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 'other-lead',
        name: 'Joao',
        phone: newCanonical,
        is_client: false,
      });

      try {
        await service.updatePhone('lead-1', '82999988877', undefined, 'admin-1');
        fail('Expected ConflictException');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        // Nest empacota o body em response.
        const body = e.getResponse();
        expect(body.conflict.id).toBe('other-lead');
        expect(body.conflict.name).toBe('Joao');
      }
    });

    it('updates phone, registers audit note, and returns updated lead', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', tenant_id: null, phone: oldPhone, name: 'X' });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.update.mockResolvedValue({ id: 'lead-1', phone: newCanonical });
      mockPrisma.leadNote.create.mockResolvedValue({});

      const result = await service.updatePhone('lead-1', '82999988877', undefined, 'admin-1');

      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { phone: newCanonical },
      });
      expect(mockPrisma.leadNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          lead_id: 'lead-1',
          user_id: 'admin-1',
          text: expect.stringContaining(`${oldPhone} para ${newCanonical}`),
        }),
      });
      expect(result.phone).toBe(newCanonical);
    });

    it('skips audit note when no actorId (internal call)', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', tenant_id: null, phone: oldPhone, name: 'X' });
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.update.mockResolvedValue({ id: 'lead-1', phone: newCanonical });

      await service.updatePhone('lead-1', '82999988877', undefined, undefined);

      expect(mockPrisma.lead.update).toHaveBeenCalled();
      expect(mockPrisma.leadNote.create).not.toHaveBeenCalled();
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
