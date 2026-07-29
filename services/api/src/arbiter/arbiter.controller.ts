import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { DcpArbiterService, type ProcessingState } from './dcp-arbiter.service';

/**
 * 처리 상태 조회 — 기자·센터 앱이 "업로드는 됐는데 왜 처리가 안 시작되지?"에 답하기 위한 표면.
 * 제온을 DCP 파이프라인과 공유하므로 DCP 작업 중에는 미디어 큐가 정지한다(DcpArbiterService).
 */
@ApiTags('system')
@ApiBearerAuth()
@Controller('system')
export class ArbiterController {
  constructor(private readonly arbiter: DcpArbiterService) {}

  @Get('processing-state')
  @Roles('reporter', 'center_operator', 'admin')
  @ApiOperation({
    summary: '미디어 처리 게이트 상태 — DCP 파이프라인과의 상호배제로 대기 중인지',
  })
  getProcessingState(): ProcessingState {
    return this.arbiter.state;
  }
}
