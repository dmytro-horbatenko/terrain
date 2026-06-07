import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ExportGeneratorService } from './export-generator.service';
import { SessionsService } from './sessions.service';

describe('SessionsService.createExport', () => {
  let service: SessionsService;
  let create: jest.Mock;
  let update: jest.Mock;

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({ id: 'sess-1' });
    update = jest.fn().mockResolvedValue({});
    const prisma = { sessionExport: { create, update } };
    const generator = {
      generate: jest.fn().mockResolvedValue('header Session: <set-on-persist>\n\nbody'),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExportGeneratorService, useValue: generator },
      ],
    }).compile();
    service = mod.get(SessionsService);
  });

  it('persists the export and injects the session id into the markdown', async () => {
    const out = await service.createExport('userA', { mode: 'full' });
    expect(out.id).toBe('sess-1');
    expect(out.exportMd).toContain('Session: sess-1');
    expect(out.exportMd).not.toContain('<set-on-persist>');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'userA' }) }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { exportMd: expect.stringContaining('Session: sess-1') },
    });
  });
});
