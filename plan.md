# Chó vs Mèo: Kế hoạch triển khai

Game bắn pháo 3D theo lượt, nhiều người chơi trên web. Hai đội Chó và Mèo thay phiên di chuyển và bắn bazooka trên một hòn đảo voxel có thể phá hủy, đạn chịu ảnh hưởng của gió. Đội thua khi toàn đội bị tiêu diệt.

**Nền tảng hiện có:** Next.js 16, React 19, Convex 1.44, Tailwind 4 (từ template có WorkOS AuthKit). Chưa có code game, chưa init git.

---

## 1. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Góc nhìn | 3D góc nhìn thứ ba, map voxel, Three.js + react-three-fiber |
| Danh tính | Guest: nhập tên, nhận token lưu `localStorage`. Gỡ AuthKit |
| Thẩm quyền | Server tính phát bắn, sát thương, phá địa hình. Client chỉ phát lại |
| Nền tảng | Desktop trước, mobile là milestone cuối. Tách lớp input từ đầu |
| Số người | Tối đa 8 (hằng số dễ đổi). Start khi mỗi đội ≥ 1. Đội được lệch số |
| Thứ tự lượt | Luân phiên đội; trong đội xoay vòng người còn sống, xáo ngẫu nhiên lúc start |
| Một lượt | 30 giây; bắn 1 phát; đồng hồ dừng khi đạn bay và nổ; sau đó 4 giây chạy thoát |
| Bắn đồng đội | Có sát thương, kể cả bản thân |
| Mất kết nối | Ở lại, mất lượt khi tới phiên, vào lại bằng token. Mất 3 lượt liên tiếp thì chết |
| Kết thúc | Cùng chết là hòa. Bảng kết quả, rồi về phòng giữ nguyên đội. Không lưu lịch sử |
| Map | Sinh từ seed mỗi trận: đảo 64×64×24, đồi, nhà/cây, xung quanh là nước |
| Phá địa hình | Khoét hố cầu. Khối bị cắt rời lơ lửng tại chỗ. Lớp đá đáy không phá được |
| Di chuyển | Chậm, tự bước bậc cao 1 khối, có nhảy |
| Chết và rơi | Xuống nước hoặc ra khỏi map chết ngay. Rơi cao trên 4 khối mất máu. Nổ có hất văng |
| Gió | Đổi đầu mỗi lượt, cố định trong lượt, đổi dần chứ không nhảy ngẫu nhiên hoàn toàn |
| Ngắm | Hiện đoạn đầu quỹ đạo 2–3 khối. Thanh lực đầy trong 2 giây, đầy thì tự bắn |
| Camera | Sau vai + Pointer Lock. Khi đạn bay thì theo đạn. Không phải lượt mình thì theo người đang chơi |
| Phòng | Mã 5 ký tự, link `/r/ABCDE`, không có danh sách công khai, không có khán giả |
| Đồ họa | Khối hộp dựng bằng code, không có file asset. Âm thanh cơ bản bằng Web Audio, không nhạc nền |
| Ngôn ngữ | Tiếng Việt, gom chuỗi một chỗ, không chat |
| Triển khai | Vercel + Convex Cloud |
| Test | Unit test vật lý, `convex-test` cho luật. Phần 3D playtest tay |

### Giả định phát sinh khi viết plan (chưa được hỏi riêng, dễ đổi)

- Đạn rơi xuống nước: không nổ, không tạo hố.
- Đạn bay ra ngoài map: mất đạn, chuyển sang giai đoạn chạy thoát.
- Lực bắn tối thiểu 15% để nhấn nhả nhanh vẫn có phát bắn.
- Trận tối đa 200 lượt, quá thì hòa. Giới hạn này để query có chặn trên và trận không kéo dài vô tận.
- Bán kính hố 3 khối, nhỏ hơn bán kính sát thương 4 khối.
- Người tự đi xuống nước trong lượt mình cũng chết.
- Phòng đầy tính theo tổng 8 người. Người mới vào được xếp vào đội ít người hơn.
- Khi trận kết thúc và về phòng, thành viên đang offline bị loại khỏi phòng.

---

## 2. Thông số khởi đầu

Toàn bộ nằm trong `shared/game/constants.ts` để chỉnh khi playtest.

| Thông số | Giá trị |
|---|---|
| Kích thước map | 64×64×24 |
| Mực nước / lớp đá đáy | y ≤ 4 là nước / y = 0–1 không phá được |
| Thời gian lượt / chạy thoát | 30 giây / 4 giây |
| Tốc độ đi | 2.5 khối/giây |
| Độ cao nhảy | 1.5 khối |
| Hitbox nhân vật | 0.8 × 1.8 × 0.8 |
| HP | 100 |
| Sát thương nổ | 50 tại tâm, giảm tuyến tính về 0 ở bán kính 4 |
| Bán kính hố | 3 khối |
| Hất văng | tối đa 12 khối/giây tại tâm, giảm tuyến tính, hướng ra ngoài và hơi lên trên |
| Sát thương rơi | 5 HP cho mỗi khối vượt quá 4 |
| Trọng lực | 20 khối/giây² |
| Vận tốc đạn tối đa | 40 khối/giây (tầm xa ~80 khối) |
| Gió tối đa | gia tốc 4 khối/giây² |
| Giới hạn bay của đạn | 10 giây |
| Bước mô phỏng | 1/60 giây, cố định |
| Gửi vị trí | 5 lần/giây, chỉ khi có thay đổi |

---

## 3. Kiến trúc

```
shared/game/        Luật và vật lý thuần TS, không phụ thuộc framework
  constants.ts      Mọi thông số
  rng.ts            PRNG có seed (mulberry32)
  terrain.ts        Sinh voxel từ seed, khoét hố, truy vấn khối
  player.ts         Di chuyển, va chạm voxel, nhảy, rơi và chết đuối
  projectile.ts     Mô phỏng đạn: trả về điểm chạm và thời gian bay
  explosion.ts      Sát thương, hất văng và kết quả sau cùng của phát bắn
  turns.ts          Chọn người chơi kế tiếp, kiểm tra thắng thua
  wind.ts           Gió lượt tiếp theo từ seed
convex/
  schema.ts
  guests.ts         Tạo guest, helper requireGuest
  rooms.ts          Tạo, vào, rời, đổi phe, ready, start
  game.ts           Query trận, updatePose, beginCharge, fire, timeout nội bộ
  crons.ts          Dọn phòng không hoạt động
app/
  page.tsx          Nhập tên, tạo phòng hoặc nhập mã
  r/[code]/page.tsx Phòng chờ và trận
game/               Client 3D (chỉ chạy phía client, dynamic import với ssr: false)
  scene/            Terrain chunk mesh, nhân vật, đạn, hiệu ứng, camera
  input/            Bàn phím + chuột; mobile thêm ở M7, cùng trả về một InputState
  hud/              Thanh lực, đồng hồ, gió, minimap, danh sách lượt
  sound.ts
lib/strings.ts      Chuỗi hiển thị tiếng Việt
```

### Nguyên tắc chính

1. **Một module vật lý, hai nơi chạy.** `shared/game` được import bởi cả mutation Convex và client. Server cho ra kết quả, client phát lại animation bằng cùng code. Mọi kết quả cuối (vị trí, HP) lấy từ server.
2. **Terrain = seed + danh sách vụ nổ.** Không lưu voxel trong database. Client và server tự dựng lại.
3. **Sinh terrain phải xác định tuyệt đối.** Bản voxel ở client và server phải trùng khớp từng khối, nên `terrain.ts` chỉ dùng PRNG có seed và phép tính số học cơ bản, không dùng `Math.random`, `Date.now`, `Math.sin`, `Math.pow`.
4. **Client không tự quyết định kết quả.** Nếu animation lệch kết quả server do sai số nhỏ, client snap về kết quả server khi animation xong.
5. **Trạng thái thay đổi liên tục tách riêng.** `livePoses` là bảng riêng, để cập nhật vị trí không làm query lại trạng thái trận (đúng guideline về dữ liệu high-churn).
6. **Thời gian do server quyết định.** Mutation ghi `phaseEndsAt` và lên lịch timeout bằng `ctx.scheduler`. Query không đọc đồng hồ, client tự đếm ngược từ `phaseEndsAt`.

### Render voxel

Chia chunk 16×16, mỗi chunk một `BufferGeometry`, chỉ tạo các mặt lộ ra ngoài. Vụ nổ chỉ dựng lại các chunk bị chạm. Minimap vẽ bằng canvas 2D từ bản đồ độ cao, cập nhật khi có vụ nổ.

---

## 4. Schema Convex

```ts
guests: { tokenHash, name }                       // index by_tokenHash

rooms: { code, status: 'lobby' | 'playing', lastActivityAt }  // M4 thêm currentGameId
                                                  // index by_code, by_lastActivityAt

roomMembers: { roomId, guestId, team: 'dog' | 'cat', ready }
                                                  // index by_roomId, by_roomId_and_guestId

games: { roomId, seed, status: 'active' | 'finished', winner: 'dog' | 'cat' | 'draw' | null,
         phase: 'aiming' | 'resolving' | 'retreat',
         turnNumber, activePlayerId, phaseEndsAt, chargeStartedAt: number | null,
         wind: { x, z }, nextTeam, order: { dog: Id[], cat: Id[], dogIndex, catIndex } }
                                                  // index by_roomId

gamePlayers: { gameId, guestId, team, name, hp, x, y, z, alive, missedTurns }
                                                  // index by_gameId, by_gameId_and_guestId

shots: { gameId, turnNumber, origin, velocity, wind, flightMs,
         impact: { x, y, z } | null,              // null: rơi xuống nước hoặc ra ngoài map
         hits: [{ playerId, damage, knockback, finalPos, hpAfter, died }] }
                                                  // index by_gameId_and_turnNumber

livePoses: { gameId, playerId, x, y, z, yaw, pitch, grounded, seq }
                                                  // index by_gameId, mỗi trận một document
```

Mọi query danh sách phải có chặn trên bằng `.take()`. `shots` bị chặn bởi giới hạn 200 lượt.

---

## 5. Luồng một lượt

```
aiming (tối đa 30 giây)
  Client người chơi gửi updatePose 5 lần/giây; client khác nội suy
  Nhấn Space  → beginCharge (ghi chargeStartedAt, mọi người thấy đang gồng)
  Nhả / đầy   → fire(yaw, pitch, power)

fire (mutation, chạy trong một transaction)
  1. Kiểm tra: token hợp lệ, đúng người, đúng phase, các số hữu hạn và trong khoảng
  2. Kiểm tra power ≤ thời gian gồng / 2 giây + dung sai 0.15
  3. Dựng terrain từ seed + shots
  4. Mô phỏng đạn → điểm chạm
  5. Tính sát thương, khoét hố, mô phỏng hất văng và rơi của mọi người còn sống
  6. Ghi shots, cập nhật gamePlayers, reset missedTurns
  7. Kiểm tra thắng thua
  8. Chuyển sang resolving, lên lịch timeout sau flightMs + 1.5 giây

resolving
  Client phát lại: camera theo đạn, nổ, mảnh vỡ, nhân vật văng

retreat (4 giây; bỏ qua nếu người bắn đã chết)
  Người chơi được di chuyển, không được bắn

kết thúc lượt (mutation nội bộ)
  Mô phỏng rơi từ vị trí cuối, tính sát thương rơi hoặc chết đuối
  Kiểm tra thắng thua, tính gió mới, chọn người kế tiếp, về aiming
```

**Timeout:** `onPhaseTimeout(gameId, turnNumber, phase)` không làm gì nếu trận đã chuyển sang lượt hoặc phase khác, nên chạy muộn hay chạy trùng đều an toàn.

**Hết 30 giây:**
- Đang gồng: server tự bắn với lực tính từ `chargeStartedAt` và góc ngắm cuối trong `livePoses`.
- Không làm gì: tăng `missedTurns` và chuyển lượt. Đủ 3 lần thì nhân vật chết.

**Offline khi tới phiên:** Dùng `@convex-dev/presence` theo guideline. Người offline bị rút thời gian lượt xuống 5 giây và vẫn tính `missedTurns`.

---

## 6. Bảo mật và kiểm tra đầu vào

Vì không có đăng nhập, token guest là thứ duy nhất chứng minh danh tính:

- Trình duyệt sinh token bằng `crypto.randomUUID()`, database chỉ lưu SHA-256. Không sinh ở server vì tài liệu Convex không đảm bảo độ ngẫu nhiên an toàn trong mutation. Client tự chọn token yếu thì chỉ hại chính họ.
- Mọi mutation có hành động của người chơi đều nhận `token`, và `requireGuest` suy ra người chơi từ token. Tuyệt đối không nhận `guestId` từ client để xác thực.
- Không query nào được trả về token hoặc `tokenHash`.
- `updatePose` kiểm tra đúng người đang tới lượt, đúng phase, giới hạn tốc độ theo thời gian giữa hai lần gửi, trong biên map. Không dựng terrain ở đây để giữ mutation rẻ.
- Tên 1–16 ký tự sau khi trim, React tự escape khi hiển thị.
- Chỉ chủ phòng được start. Server kiểm tra lại mọi điều kiện start.

**Giới hạn đã biết:** vị trí vẫn do client báo, chỉ kiểm tra tốc độ, nên client sửa đổi có thể đi xuyên tường hoặc né sát thương rơi. Chấp nhận được vì chơi với người quen. Nếu chơi công khai thì cần kiểm tra va chạm voxel phía server.

---

## 7. Milestone

### M0: Dọn nền
- `git init`, commit nguyên trạng template.
- Gỡ AuthKit: `proxy.ts`, `app/callback`, `app/sign-in`, `app/sign-up`, `app/server`, `convex/auth.config.ts`, gói `@workos-inc/authkit-nextjs`, mục `authKit` trong `convex.json`, cờ `convex-authkit-auto-provisioning` trong `package.json`, env `WORKOS_CLIENT_ID` trong `convex/convex.config.ts`, các biến trong `.env.local.example`.
- Xóa `convex/myFunctions.ts` và bảng `numbers`. Đổi `ConvexClientProvider` sang `ConvexProvider` thường.
- Cài `three`, `@react-three/fiber`, `@types/three`, `vitest`, `convex-test`, `@edge-runtime/vm`.

**Xong khi:** `npm run build` và `npm run lint` qua, `npm run dev` hiện trang trống không lỗi, không còn tham chiếu WorkOS.

### M1: Module vật lý dùng chung
- Viết toàn bộ `shared/game` kèm unit test.

**Xong khi test chứng minh được:**
- Cùng seed cho ra đúng cùng một terrain.
- Quỹ đạo không gió khớp công thức parabol. Gió đẩy đạn đúng hướng.
- Sát thương giảm theo khoảng cách, đúng ở tâm và ở rìa.
- Hố đúng bán kính, lớp đá đáy còn nguyên.
- Nhân vật mất đất sẽ rơi, xuống nước thì chết, rơi cao mất máu.
- Chọn lượt bỏ qua người chết, xử lý đúng khi đội lệch số. Phát hiện đúng thắng, thua, hòa.
- Benchmark: dựng terrain + 200 hố + một phát bắn hoàn chỉnh dưới 100 ms, để an toàn với giới hạn thời gian chạy của mutation Convex.

### M2: Sandbox 3D offline
- Render đảo voxel, nhân vật khối hộp, di chuyển, nhảy, camera sau vai, Pointer Lock.
- Gồng lực, bắn, gió, nổ, hố, hất văng, hiệu ứng mảnh vỡ. Hai nhân vật luân phiên trên cùng một máy.
- Trang `/sandbox` chỉ dùng khi phát triển.

**Xong khi:** chơi thử thấy vui, ngắm được, chỉnh xong thông số chính, và 60 FPS trên laptop thường kể cả khi đang dựng lại chunk. Đây là điểm kiểm tra lớn nhất của dự án: nếu chưa vui thì chỉnh tiếp, chưa làm mạng.

### M3: Phòng chờ
- Nhập tên, tạo phòng, vào bằng mã hoặc link, đổi phe, ready, start.
- Rời phòng, online/offline bằng presence, cron dọn phòng không hoạt động 30 phút.
- Chủ phòng không lưu trong database: luôn là người online vào sớm nhất, nên rời hay rớt mạng đều tự chuyển. Người cũ quay lại thì nhận lại quyền.
- Người offline không chặn start và bị loại khỏi phòng lúc start. Trong phòng chờ, phòng đầy thì người mới thay chỗ người offline.
- Người ngoài phòng không xem được danh sách thành viên.

**Xong khi:** `convex-test` qua các trường hợp phòng đầy, sai mã, phòng đang chơi, không phải chủ phòng bấm start, chưa đủ ready, token sai. Thử bằng 3 tab thấy đồng bộ.

### M4: Trận nhiều người
- `game.ts`: start trận, `updatePose`, `beginCharge`, `fire`, timeout, gió, đổi lượt, kết thúc trận, về phòng.
- Nối sandbox với dữ liệu server: nội suy người khác, phát lại phát bắn, camera theo diễn biến.
- HUD tối thiểu: đồng hồ, thanh lực.
- Deploy lần đầu lên Vercel + Convex để rủ người test.

**Xong khi:** hai máy khác nhau chơi trọn một trận qua URL thật. `convex-test` qua các trường hợp bắn sai lượt, bắn hai phát, timeout chạy muộn, tự bắn khi hết giờ lúc đang gồng, vào lại sau khi mất kết nối, mất 3 lượt thì chết. Theo dõi số function call trong dashboard Convex, đối chiếu với hạn mức gói miễn phí.

### M5: HUD đầy đủ
- Minimap, chỉ báo gió, danh sách lượt kèm HP, tên và thanh máu trên đầu, thanh thời gian, thông báo tới lượt, bảng kết quả.

**Xong khi:** người mới biết đang tới lượt ai, gió thế nào, còn bao lâu mà không cần hỏi.

### M6: Hoàn thiện
- Âm thanh, animation đi, rung camera, bản build production, xử lý khi Convex mất kết nối, cân bằng thông số sau playtest.
- Thêm sau playtest 2v2: đạn bay chậm hơn trên cùng đường bay (`SHOT_TIME_SCALE`), lá và vệt gió trong cảnh (`WindEffects.tsx`).
- Thêm sau playtest: người xem phát lại pose của người đang chơi bằng bộ đệm trễ theo đồng hồ người gửi (`posePlayback.ts`, cột `livePoses.sentAt`). Đo thật: pose về cách nhau ~294 ms vì mỗi lần gửi chờ round trip, người xem chậm hơn người chơi ~660 ms.

**Xong khi:** chơi trọn trận 4v4 không gặp lỗi chặn trận.

### M7: Mobile
- Joystick trái để đi, vuốt phải để xoay camera, nút bắn ở góc trên, nút nhảy, chế độ ngang, gợi ý xoay màn hình. Thay thế Pointer Lock.

**Xong khi:** chơi trọn trận trên điện thoại cùng với người dùng desktop.

---

## 8. Rủi ro

| Rủi ro | Cách xử lý |
|---|---|
| Game không vui hoặc khó ngắm | M2 kiểm tra trước khi làm mạng |
| Mutation `fire` chạy quá lâu | Benchmark ở M1. Có thể giảm map hoặc tối ưu terrain |
| Client và server lệch terrain | Quy tắc số 3 + test tính xác định, có thể so hash terrain khi phát triển |
| Di chuyển giật do pose về thưa (~3,4 lần/giây thực tế) | Đã làm bộ đệm phát trễ ~660 ms. Nếu đường đi quá thô, gửi nhiều mẫu trong một mutation. Dịch vụ realtime riêng là phương án cuối |
| Vượt hạn mức gói miễn phí Convex | Đo ở M4. Giảm tần suất, chỉ gửi khi có thay đổi |
| FPS thấp trên máy yếu hoặc mobile | Chunk mesh chỉ có mặt lộ, giới hạn mảnh vỡ, giảm pixel ratio |

---

## 9. Để sau

Chỉ thêm khi có nhu cầu thật: nhiều loại vũ khí và vật phẩm, map thiết kế tay, bay camera tự do, chế độ khán giả, chat, đăng nhập, lưu lịch sử và xếp hạng, khối rơi theo vật lý, model `.glb`, đa ngôn ngữ, E2E test, giới hạn tần suất tạo phòng (`@convex-dev/rate-limiter`, cần nếu mở công khai), kiểm tra va chạm voxel phía server.
