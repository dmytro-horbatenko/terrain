import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { McpBearerGuard } from './mcp-bearer.guard';
import { McpService } from './mcp.service';

const METHOD_NOT_ALLOWED = {
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed.' },
  id: null,
};

@Public()
@UseGuards(McpBearerGuard)
@Controller('mcp')
export class McpController {
  constructor(private mcp: McpService) {}

  @Post()
  handle(@Req() request: Request & { userId: string }, @Res() response: Response): Promise<void> {
    return this.mcp.handle(request, response, request.userId);
  }

  @Get()
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  get() {
    return METHOD_NOT_ALLOWED;
  }

  @Delete()
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  delete() {
    return METHOD_NOT_ALLOWED;
  }
}
