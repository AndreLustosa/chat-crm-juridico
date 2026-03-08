import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let prisma: any;
  let chatGateway: any;

  beforeEach(async () => {
    prisma = {
      conversation: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      message: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    chatGateway = {
      emitTransferRequest: jest.fn(),
      emitTransferResponse: jest.fn(),
      emitTransferReturned: jest.fn(),
      emitConversationsUpdate: jest.fn(),
      emitNewMessage: jest.fn(),
      server: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
    };

    const mockWhatsappService = {
      markAsRead: jest.fn(),
      sendPresence: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatGateway, useValue: chatGateway },
        { provide: WhatsappService, useValue: mockWhatsappService },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('assign', () => {
    it('deve atribuir conversa ao usuario e desativar ai_mode', async () => {
      const mockConv = { id: 'conv-1', assigned_user_id: 'user-1', ai_mode: false };
      prisma.conversation.update.mockResolvedValue(mockConv);

      const result = await service.assign('conv-1', 'user-1');

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { assigned_user_id: 'user-1', ai_mode: false },
      });
      expect(result).toEqual(mockConv);
    });
  });

  describe('close', () => {
    it('deve fechar a conversa com status FECHADO', async () => {
      const mockConv = { id: 'conv-1', status: 'FECHADO' };
      prisma.conversation.update.mockResolvedValue(mockConv);

      const result = await service.close('conv-1');

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { status: 'FECHADO' },
      });
      expect(result.status).toBe('FECHADO');
    });
  });

  describe('findAll', () => {
    it('deve excluir conversas fechadas por padrao', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);
      prisma.conversation.count.mockResolvedValue(0);

      await service.findAll();

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { not: 'FECHADO' } },
        }),
      );
    });

    it('deve filtrar por status quando fornecido', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);
      prisma.conversation.count.mockResolvedValue(0);

      await service.findAll('ABERTO');

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ABERTO' },
        }),
      );
    });

    it('deve filtrar por inbox para usuarios nao-admin', async () => {
      const mockUser = {
        id: 'user1',
        role: 'OPERATOR',
        inboxes: [{ id: 'inbox1' }, { id: 'inbox2' }],
      };
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.conversation.findMany.mockResolvedValue([]);
      prisma.conversation.count.mockResolvedValue(0);

      await service.findAll(undefined, 'user1');

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            inbox_id: { in: ['inbox1', 'inbox2'] },
          }),
        }),
      );
    });

    it('deve enriquecer com nomes de advogado e atendente de origem', async () => {
      const mockConversations = [{
        id: 'conv1',
        lead_id: 'lead1',
        channel: 'whatsapp',
        status: 'ABERTO',
        ai_mode: false,
        assigned_user_id: 'user1',
        assigned_lawyer_id: 'lawyer1',
        origin_assigned_user_id: 'origin1',
        last_message_at: new Date(),
        lead: { id: 'lead1', name: 'Test', phone: '551', email: null, stage: 'NOVO', profile_picture_url: null },
        messages: [{ text: 'Hello' }],
        assigned_user: { id: 'user1', name: 'Agent' },
      }];
      prisma.conversation.findMany.mockResolvedValue(mockConversations);
      prisma.conversation.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([
        { id: 'lawyer1', name: 'Dr. Lawyer' },
        { id: 'origin1', name: 'Origin Agent' },
      ]);

      const result = await service.findAll();

      expect(result.data[0].assignedLawyerName).toBe('Dr. Lawyer');
      expect(result.data[0].originAssignedUserName).toBe('Origin Agent');
    });
  });

  describe('requestTransfer', () => {
    it('deve lançar ForbiddenException se conversa nao pertence ao solicitante', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          conversation: {
            findUnique: jest.fn().mockResolvedValue({
              assigned_user_id: 'outro-user',
              pending_transfer_to_id: null,
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn() },
        };
        return fn(tx);
      });

      await expect(
        service.requestTransfer('conv-1', 'target-user', 'user-1', 'motivo'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar BadRequestException se ja existe transferencia pendente', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          conversation: {
            findUnique: jest.fn().mockResolvedValue({
              assigned_user_id: 'user-1',
              pending_transfer_to_id: 'already-pending',
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn() },
        };
        return fn(tx);
      });

      await expect(
        service.requestTransfer('conv-1', 'target-user', 'user-1', null),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve transferir e emitir evento via gateway quando valido', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          conversation: {
            findUnique: jest.fn().mockResolvedValue({
              assigned_user_id: 'user-1',
              pending_transfer_to_id: null,
            }),
            update: jest.fn().mockResolvedValue({
              id: 'conv-1',
              lead: { name: 'Cliente', phone: '11999' },
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue({ name: 'Operador 1' }),
          },
        };
        return fn(tx);
      });

      await service.requestTransfer('conv-1', 'target-user', 'user-1', 'motivo urgente');

      expect(chatGateway.emitTransferRequest).toHaveBeenCalledWith(
        'target-user',
        expect.objectContaining({
          conversationId: 'conv-1',
          fromUserId: 'user-1',
          fromUserName: 'Operador 1',
          reason: 'motivo urgente',
        }),
      );
      expect(chatGateway.emitConversationsUpdate).toHaveBeenCalled();
    });
  });

  describe('acceptTransfer', () => {
    it('deve lançar ForbiddenException se usuario nao e destinatario', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          conversation: {
            findUnique: jest.fn().mockResolvedValue({
              pending_transfer_to_id: 'other-user',
              pending_transfer_from_id: 'from-user',
              lead: { name: 'Cliente' },
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn() },
        };
        return fn(tx);
      });

      await expect(service.acceptTransfer('conv-1', 'wrong-user'))
        .rejects.toThrow(ForbiddenException);
    });

    it('deve aceitar transferencia e emitir resposta ao remetente', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          conversation: {
            findUnique: jest.fn().mockResolvedValue({
              pending_transfer_to_id: 'dest-user',
              pending_transfer_from_id: 'from-user',
              lead: { name: 'Cliente' },
            }),
            update: jest.fn().mockResolvedValue({ id: 'conv-1' }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue({ name: 'Destino' }),
          },
        };
        return fn(tx);
      });

      await service.acceptTransfer('conv-1', 'dest-user');

      expect(chatGateway.emitTransferResponse).toHaveBeenCalledWith(
        'from-user',
        expect.objectContaining({ accepted: true }),
      );
      expect(chatGateway.emitConversationsUpdate).toHaveBeenCalled();
    });
  });

  describe('declineTransfer', () => {
    it('deve recusar transferencia e emitir resposta ao remetente', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          conversation: {
            findUnique: jest.fn().mockResolvedValue({
              pending_transfer_from_id: 'from-user',
              lead: { name: 'Cliente', phone: '11999' },
            }),
            update: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      await service.declineTransfer('conv-1', 'nao tenho disponibilidade');

      expect(chatGateway.emitTransferResponse).toHaveBeenCalledWith(
        'from-user',
        expect.objectContaining({
          accepted: false,
          reason: 'nao tenho disponibilidade',
        }),
      );
    });
  });

  describe('countOpen', () => {
    it('deve contar conversas nao-fechadas', async () => {
      prisma.conversation.count.mockResolvedValue(5);

      const result = await service.countOpen();
      expect(result).toBe(5);
      expect(prisma.conversation.count).toHaveBeenCalledWith({
        where: { status: { not: 'FECHADO' } },
      });
    });
  });
});
