# infra/backup — 백업 (대장 #153)

## 지금 상태 (2026-08-22 실측)

| 대상 | 사본 수 | 비고 |
|---|---:|---|
| 미디어 원본 (`/srv/dcpwork/minio`, **542 MB**) | 1 → **2**(NAS 구성 후) | 재취득 불가 자산 |
| PostgreSQL 메타데이터 | 0 → **2** | 이것 없으면 미디어가 무엇인지 알 수 없다 |

⚠️ **착수 전 확인에서 드러난 사실**: `pg-dump-to-r2.sh`(T-W0-04)는 작성돼 있었지만
**제온의 crontab·systemd timer 어디에도 등록돼 있지 않아 한 번도 돈 적이 없었다.**
스크립트의 존재는 백업의 존재가 아니다. 그래서 아래 절차의 마지막이 **등록 확인**이다.

## 오프사이트가 아니다 — 무엇을 막고 무엇을 못 막는가

NAS(192.168.0.7)는 제온과 **같은 건물**에 있다.

- ✅ 막는 것: 디스크 장애 · 호스트 고장 · 실수로 인한 삭제 · 잘못된 마이그레이션
- ❌ 못 막는 것: 화재 · 도난 · 낙뢰 · 건물 단위 사고

진짜 오프사이트(R2 콜드 스토리지)는 **별건으로 남아 있다**(계정·결제수단 필요 → 사용자 결정 대기).
그럼에도 지금 넣는 이유: **사본 1개와 2개의 차이가 2개와 3개의 차이보다 훨씬 크다.**

## 설정 절차

### ① NAS에 전용 공유 만들기 — **사용자 작업**

NAS 관리 화면에서 공유 하나를 새로 만든다(예: `gachinol-backup`).

- 기존 공유(`Cowork`·`homes`·`photo`·`old dcp`)를 재사용하지 **않는다** — 2종은 읽기 전용이고
  1종은 타 프로젝트 실자산 2.1TB를 점유한다(infra §4-A ④).
- 백업 전용 계정을 쓰고 **그 공유에만** 쓰기 권한을 준다. 백업 자격증명이 새어도 피해를 가둔다.

### ② 제온에 마운트 — **사용자 작업**(자격증명을 다루므로)

```bash
# 자격증명 파일 (root만 읽기)
sudo install -m 600 /dev/null /etc/gachinol-backup.cred
sudo tee /etc/gachinol-backup.cred >/dev/null <<'EOF'
username=<백업전용계정>
password=<비밀번호>
EOF

sudo mkdir -p /mnt/gachinol-backup
```

`/etc/fstab`에 추가 — **`nofail`이 필수다**:

```
//192.168.0.7/gachinol-backup /mnt/gachinol-backup cifs credentials=/etc/gachinol-backup.cred,uid=homedcp,gid=homedcp,file_mode=0644,dir_mode=0755,nofail,_netdev,x-systemd.automount 0 0
```

> ⚠️ **`nofail` 없이 두면 NAS가 꺼져 있을 때 부팅이 emergency mode로 빠진다.**
> 제온은 헤드리스라 그 상태에서는 SSH도 안 된다 — `/srv/dcpwork`가 이미 같은 이유로
> `nofail`을 달고 있다([xeon-host-operations] 참조).
>
> **호스트명이 아니라 IP를 쓴다**: 제온의 `/etc/resolv.conf`가 Tailscale MagicDNS로 덮여 있어
> `HomeDCP`·`homedcp.local`이 해석되지 않는다(실측 2026-08-22 — 445/139/2049는 IP로 전부 열려 있다).

```bash
sudo systemctl daemon-reload && sudo mount -a
mountpoint /mnt/gachinol-backup   # ← 여기서 확인되어야 다음으로 간다
```

### ③ 타이머 등록

```bash
sudo cp infra/backup/gachinol-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gachinol-backup.timer

systemctl list-timers gachinol-backup      # ★ 등록 확인 — 이걸 봐야 "돌고 있다"고 말한다
```

### ④ 첫 실행과 검증

```bash
./infra/backup/media-to-nas.sh --dry-run   # 계획만
sudo systemctl start gachinol-backup       # 실제 1회
journalctl -u gachinol-backup -n 30 --no-pager
./infra/backup/media-to-nas.sh --verify    # 덤프 무결성 + 객체 수 대조
```

## 설계 결정

- **`rsync --delete`를 쓰지 않는다.** 원본에서 지워진 객체를 사본에서도 지우면 실수·버그로 인한
  삭제가 그대로 전파돼 백업의 존재 이유가 사라진다. 용량 여유가 크다(542MB vs 2.6TB).
- **PG 덤프만 보존 기간(기본 30일)을 적용한다** — 미디어는 지우지 않는다.
- **마운트가 없으면 즉시 실패한다.** 로컬 디스크에 백업을 쌓으면 디스크를 채우면서
  "백업이 되고 있다"는 착각까지 준다.
- **cron이 아니라 systemd timer** — `Persistent=true`로 놓친 실행을 따라잡고, 실패가
  `journalctl`에 남는다. cron은 메일 설정이 없으면 조용히 사라진다.

## 복구

절차는 `media-to-nas.sh` 하단 주석에 있다(PG는 임시 DB로 받아 확인 후 교체, 미디어는 MinIO 정지 후 되돌림).

⚠️ **두 절차를 실제로 실행해 본 적이 없다면 백업이 있다고 말하지 않는다.**
분기 1회 리허설(T-NC-15) 결과는 날짜와 함께 `docs/infrastructure.md`에 남긴다.
