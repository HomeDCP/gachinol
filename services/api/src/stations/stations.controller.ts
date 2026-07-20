import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated, Station, User } from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateStationDto,
  StationListQueryDto,
  TransitionStationDto,
  UpdateStationDto,
} from './schemas/station.schemas';
import { StationWorkflowService } from './station-workflow.service';
import { toStation } from './station.mapper';
import { StationsService } from './stations.service';

@ApiTags('stations')
@ApiBearerAuth()
@Controller('stations')
export class StationsController {
  constructor(
    private readonly stations: StationsService,
    private readonly workflow: StationWorkflowService,
  ) {}

  @Get()
  @ApiOperation({ summary: '지사 목록 (관리 화면용 — 구독자 공개 목록은 후속 subscriber DTO)' })
  list(@Query() query: StationListQueryDto): Promise<Paginated<Station>> {
    return this.stations.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '지사 단건 조회' })
  get(@Param('id') id: string): Promise<Station> {
    return this.stations.get(id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: '지사 생성 (status=planned로 시작)' })
  create(@Body() body: CreateStationDto): Promise<Station> {
    return this.stations.create(body);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: '지사 수정' })
  update(@Param('id') id: string, @Body() body: UpdateStationDto): Promise<Station> {
    return this.stations.update(id, body);
  }

  @Post(':id/transitions')
  @HttpCode(200)
  @Roles('admin', 'center_operator')
  @ApiOperation({ summary: '지사 상태 전이 — dormant→operating 부활(MVP: 애월·제주시) 등' })
  async transition(
    @Param('id') id: string,
    @Body() body: TransitionStationDto,
    @CurrentUser() user: User,
  ): Promise<Station> {
    const row = await this.workflow.transition(id, body.toStatus, user, body.note);
    return toStation(row);
  }
}
