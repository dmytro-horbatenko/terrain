import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('topic-types')
export class TopicTypesController {
  constructor(private prisma: PrismaService) {}
  @Get() findAll(@CurrentUser() userId: string) {
    return this.prisma.topicType.findMany({ where: { userId }, orderBy: { label: 'asc' } });
  }
}
