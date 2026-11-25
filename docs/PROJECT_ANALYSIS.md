# PROJECT_ANALYSIS.md — eTax Manager HAK Group

Bước 1 theo yêu cầu "MASTER PROMPT — ETAX DOWNLOAD MANAGER ENTERPRISE v2.0": đọc toàn bộ source, KHÔNG sửa code.
Tài liệu này là kết quả đọc thật toàn bộ 89 file / ~10.800 dòng code của dự án (không đoán).

---

## 1. Kiến trúc hiện tại — tổng quan thật

Đây **không phải** một phần mềm nhỏ/thô sơ. Đọc kỹ thì thấy dự án đã có khá nhiều thứ mà bản "wishlist Enterprise"
liệt kê — chỉ là chưa được gọi bằng những cái tên đó. Bảng dưới đối chiếu từng khoản trong **Giai đoạn 1 (Ưu tiên rất
cao)** bạn đề xuất với những gì code THẬT SỰ đang có:

| Hạng mục bạn đề xuất | Hiện trạng thật (đọc code) |
|---|---|
| Queue Manager pause/resume/priority | **Đã có pause/resume** — nhưng chỉ trong công cụ tải thủ công của tiện ích (`extension/content.js`, nút Tạm dừng/Tiếp tục/Dừng, trạng thái lưu vào IndexedDB nên sống sót qua reload). Lượt đồng bộ chính của app (`syncEngine.js`/`bridge.js`) chỉ có **Hủy** (cancel qua AbortSignal), chưa có tạm dừng/tiếp tục. **"Priority"**: mỗi lúc chỉ có đúng 1 lượt đồng bộ chạy (`state.syncing` khóa) — chưa rõ có nhiều tác vụ cùng lúc để cần xếp ưu tiên hay không (xem mục 3, câu hỏi cần bạn trả lời). |
| Download Engine đa luồng, số luồng cấu hình được | **Có đa luồng ở một chỗ**: tải chi tiết hàng hóa dùng `pool(need, 2, ...)` (2 luồng song song). Nhưng: số luồng (2) là hard-code, không có ô cấu hình; phần tải XML (nơi tốn thời gian nhất) chạy **tuần tự**, có giãn cách cố định (`GAP_MS=1000ms` ở extension, `minGapMs=250ms` ở app) — cũng hard-code. |
| Đồng bộ gia tăng (chỉ tải mới/thay đổi) | **ĐÃ CÓ ĐẦY ĐỦ**, không phải xây mới. `syncEngine.js` có `incrementalRange()` lưu mốc theo từng (doanh nghiệp, chiều) vào store `syncState`, lùi lại 3 ngày để bắt hóa đơn nộp trễ. Có cả công tắc trên giao diện trang Đồng bộ ("Gia tăng — chỉ phần mới"). `autosync.js` (tự động đồng bộ định kỳ) luôn chạy ở chế độ này. |
| Dashboard thời gian thực: tiến độ, tốc độ, ETA | **Có tiến độ % + thông điệp**, chưa có **tốc độ (item/giây) và ETA (thời gian còn lại)** — đây là khoảng trống thật. Chỉ có tổng thời gian sau khi xong (không phải dự đoán trong lúc chạy). |
| Retry thông minh theo từng loại lỗi | **ĐÃ CÓ, khá kỹ** — không phải xây mới. 3 tầng: (a) `api.js` phân biệt lỗi có thể thử lại (429/5xx) và lỗi không thử lại (401/403); (b) tiện ích phân biệt riêng **mã 500** (2 lần thử) với **429/502/503/504** (6 lần thử) — chính là phần chúng ta vừa làm tuần trước sau khi xác nhận hóa đơn "Không mã" lỗi 500 vĩnh viễn; (c) một bộ lọc bị lỗi không làm dừng cả lượt đồng bộ, các bộ lọc khác vẫn tiếp tục.

**Kết luận quan trọng**: nếu làm theo đúng "Giai đoạn 1" như liệt kê, phần lớn công sức sẽ là **làm lại thứ đã chạy
tốt** (đồng bộ gia tăng, retry thông minh) — vi phạm đúng nguyên tắc "không được viết lại khi đang chạy tốt" mà bạn
đặt ra. Khoảng trống THẬT trong Giai đoạn 1 hẹp hơn nhiều: chỉ còn **(1) số luồng tải cấu hình được thay vì hard-code,
(2) tốc độ/ETA thời gian thực, (3) tạm dừng/tiếp tục cho lượt đồng bộ chính (không chỉ công cụ tải thủ công)**.

---

## 2. Đối chiếu Giai đoạn 2 và 3

**Giai đoạn 2:**
- *Quản lý nhiều doanh nghiệp và nhiều tài khoản* — **ĐÃ CÓ ĐẦY ĐỦ**, không phải xây mới. Store `companies` +
  `accounts` riêng, dữ liệu từng MST tách biệt hoàn toàn ở tầng khóa chính, có cơ chế chống gán nhầm hóa đơn sang
  sai doanh nghiệp khi đồng bộ qua tiện ích.
- *Lưu lịch sử tải, đối chiếu, trạng thái xử lý* — **Có một phần**: Nhật ký (store `logs`, tự dọn khi vượt 5000
  dòng) ghi lại đăng nhập/đồng bộ/tìm kiếm/xuất/lỗi. Chưa có "lịch sử tải" dạng danh sách các lần chạy riêng biệt
  xem lại được (hiện chỉ có dòng log rời rạc, không gộp thành 1 "phiên tải #N với đầy đủ thống kê").
- *Bộ lọc và tìm kiếm nâng cao* — **Đã có**: trang Tra cứu lọc theo số/ký hiệu/MST/tên/ngày/số tiền/trạng thái;
  lưới dữ liệu (`datagrid.js`) có lọc theo từng cột, sắp xếp, chọn nhiều dòng.

**Giai đoạn 3** — đây là 3 khoản **thật sự chưa có gì**, và cũng là 3 khoản **lớn nhất, rủi ro kiến trúc cao nhất**:
- *Kiến trúc Plugin cho nhà cung cấp hóa đơn khác (MISA, VNPT, BKAV, Viettel...)* — hiện toàn bộ mô hình dữ liệu,
  tên trường (`tdlap`, `nbmst`, `khhdon`...), đường dẫn API, tiêu đề HTTP đều gắn chặt với cổng
  hoadondientu.gdt.gov.vn. Có đúng 1 điểm nối đã sẵn sàng để mở rộng (`GdtClient`/`DemoClient` dùng chung interface),
  nhưng xây một hệ plugin thật sự cho nhà cung cấp khác là **một dự án riêng, không phải một tính năng**.
- *API nội bộ để kết nối phần mềm kế toán/ERP* — chưa có gì.
- *Hệ thống cập nhật phiên bản tự động* — chưa có (hiện phát hành bằng cách gửi lại `eTax.zip` thủ công).

---

## 3. Những xung đột kiến trúc cần bạn quyết định TRƯỚC khi thiết kế lại (Bước 3)

Đây là phần quan trọng nhất — nếu làm sai những quyết định này thì sẽ phải đập đi làm lại.

### 3.1. SQLite thay cho IndexedDB?
Dự án hiện chạy được theo **2 cách hoàn toàn không cần cài đặt gì**: (a) mở thẳng trong trình duyệt qua server cục
bộ (`Chay-eTax.bat` chạy `node server/server.mjs` rồi mở trình duyệt), (b) bản Electron đóng gói. Cả hai đều dùng
chung một tầng lưu trữ IndexedDB chạy trong trình duyệt/renderer. **SQLite không chạy được trong trình duyệt** (chỉ
chạy được trong Electron/Node) — nếu chuyển sang SQLite sẽ **mất khả năng chạy thẳng bằng trình duyệt không cần cài
đặt**, vốn là ưu điểm lớn nhất hiện tại (nhân viên chỉ cần bấm file `.bat`, không cần cài Electron).
→ **Cần bạn trả lời**: có chấp nhận bỏ đường chạy qua trình duyệt, chuyển hẳn sang chỉ dùng bản Electron không?
Nếu không, SQLite chỉ có thể làm **song song** (2 tầng lưu trữ, đồng bộ qua lại) — phức tạp hơn nhiều so với lợi ích
thực tế, vì IndexedDB hiện tại (dùng mẫu Repository sẵn có, đã có transaction, index, migration) chưa hề bộc lộ vấn
đề hiệu năng nào trong log/test.

### 3.2. Mã hóa AES cho dữ liệu lưu trữ?
Đã xác nhận qua đọc code: **mật khẩu và token phiên đăng nhập KHÔNG BAO GIỜ được lưu xuống đâu cả** (không
IndexedDB, không localStorage, không đĩa) — mật khẩu chỉ tồn tại trong biến tạm lúc gõ, xóa ngay sau khi gửi đi;
token chỉ nằm trong `sessionStorage` (mất khi đóng tab). Mục tiêu "không lưu password/token dạng plain text" **coi
như đã đạt từ trước** — vì đơn giản là không lưu gì cả, không phải lưu-rồi-mã-hóa.
Câu hỏi còn mở là khác: có cần **mã hóa toàn bộ dữ liệu hóa đơn** (doanh thu, tên đối tác...) nằm trong IndexedDB
không? Muốn làm việc này cần thêm UI "mật khẩu chủ" (master password) mỗi lần mở app — một tính năng UX hoàn toàn
mới, ảnh hưởng mọi màn hình, chưa từng có trong yêu cầu trước đây của bạn.
→ **Cần bạn trả lời**: mục tiêu bảo mật thực sự bạn cần là gì — (a) không để lộ mật khẩu/token (đã đạt), hay
(b) mã hóa dữ liệu hóa đơn tại chỗ phòng khi máy bị truy cập trái phép (tính năng mới, cần thiết kế UX riêng)?

### 3.3. Đổi cấu trúc thư mục /core /modules /services /repositories /providers /workers /plugins...
Dự án hiện đã có tổ chức tương đương một phần thật (`js/core/` cho logic dùng chung, `js/views/` cho từng trang,
mẫu Repository đã dùng trong `storage.js`) — nhưng **không qua bước build/bundler**: mọi file là ES module load
thẳng bằng trình duyệt (`<script type=module>`), import bằng đường dẫn tương đối. Đổi toàn bộ cấu trúc thư mục như
đề xuất sẽ động vào đường import của gần như toàn bộ 89 file — chắc chắn vượt ngưỡng 10% mã nguồn bạn tự đặt ra,
và có rủi ro cao làm hỏng router (`core/router.js` dùng `import()` động theo đường dẫn cố định cho từng trang).

---

## 4. Vấn đề chất lượng code thật sự quan sát được (rút gọn từ việc đọc toàn bộ)

- `extension/content.js` (542 dòng) là file duy nhất vượt 500 dòng, gộp 5-6 trách nhiệm khác nhau (giao diện, ghi
  XLSX riêng, đọc ZIP, máy trạng thái tải thủ công, chạy job cầu nối, polling) — ứng viên tốt nhất để tách nhỏ.
- File ghi XLSX bị trùng lặp: `extension/content.js` có bản viết XLSX riêng (`makeXlsx`), khác với
  `js/core/xlsx.js` — trùng vì tiện ích chạy tách biệt, không import được module của app. Rủi ro: sửa 1 bên quên
  sửa bên kia (bản trong extension thiếu style/tô màu dòng mà bản app có).
- Logic chốt mốc đồng bộ gia tăng bị viết 2 lần độc lập (`syncEngine.js` dòng 97 và `bridge.js` dòng 91+124) —
  đọc mốc thì dùng chung hàm, nhưng ghi mốc thì copy-paste. Sửa hình dạng bản ghi phải sửa 2 chỗ.
  → Đây là ứng viên hợp lý để gộp thành 1 hàm `checkpointSync()` dùng chung — rủi ro thấp, lợi ích rõ.
- Vài hằng số nên là cài đặt thay vì hard-code: số luồng tải chi tiết (2), độ giãn cách giữa các lượt gọi
  (1000ms/250ms), số hóa đơn tối đa mỗi phần ZIP (200), ngưỡng thử lại theo mã lỗi (6 lần / 2 lần).
- `extension/content.js` gọi `fetch()` không đặt timeout rõ ràng (khác với `api.js` phía app luôn có
  AbortController hẹn giờ) — lỗ hổng nhỏ, nên bổ sung.
- Không phát hiện vấn đề callback lồng sâu — toàn bộ code đã dùng async/await nhất quán.
- Không phát hiện thiếu retry ở chỗ cần retry — các chỗ không retry (401/403, bị chặn chống bot) là **cố ý**, có
  comment giải thích rõ lý do (không lách chặn chống bot).

---

## 5. Đề xuất — lộ trình thực tế (không đề xuất SQLite/Plugin/AES ngay)

Vì phần lớn "Giai đoạn 1" đã có sẵn, đề xuất một Giai đoạn 1 **hẹp hơn nhiều, rủi ro thấp**, chỉ nhắm đúng khoảng
trống thật đã xác nhận ở mục 1:

**Phase 1a — Cấu hình được số luồng tải + độ giãn cách** (rủi ro thấp, không đổi hành vi mặc định)
Thêm ô cấu hình ở trang Cài đặt cho số luồng tải song song và độ giãn cách giữa các lượt gọi, đọc từ
`state.settings` thay vì hard-code. Không đổi giá trị mặc định hiện tại (2 luồng, 250ms/1000ms) nên không ảnh
hưởng ai đang dùng ổn định.

**Phase 1b — Tốc độ + ETA thời gian thực trên thanh tiến độ** (rủi ro thấp, chỉ thêm UI)
Tận dụng `progressPanel()` đã có sẵn — tính tốc độ từ số hóa đơn đã xử lý / thời gian trôi qua, suy ra ETA. Không
đổi luồng xử lý, chỉ thêm phép tính hiển thị.

**Phase 1c — Tạm dừng/Tiếp tục cho lượt đồng bộ chính** (rủi ro trung bình — cần bàn kỹ)
Cần làm rõ: vì đã có đồng bộ gia tăng (hủy giữa chừng thì lần sau tự tiếp tục từ mốc gần nhất, gần như không mất
gì), lợi ích của việc thêm nút Tạm dừng/Tiếp tục thật sự là gì so với Hủy rồi chạy lại? Nếu câu trả lời là "muốn
tạm dừng để nhường băng thông rồi tiếp tục đúng giữa chừng thay vì tính lại từ đầu trang đang tải", thì cần thiết
kế riêng; nếu đồng bộ gia tăng đã đủ đáp ứng nhu cầu thực tế thì có thể bỏ khoản này.

**Chưa đề xuất làm ngay**: gộp trùng lặp XLSX/checkpoint (mục 4) — có thể làm sau, rủi ro thấp nhưng không cấp
bách; toàn bộ Giai đoạn 3 (Plugin/API/tự cập nhật) và SQLite/AES/đổi cấu trúc thư mục (mục 3) — cần bạn quyết định
các câu hỏi ở mục 3 trước, vì chọn sai hướng sẽ phải làm lại.

---

## 6. Câu hỏi cần bạn trả lời trước khi viết bất kỳ dòng code nào

1. Trong Phase 1c, "Tạm dừng/Tiếp tục" và "ưu tiên tác vụ" cho lượt đồng bộ chính — có thật sự cần không, khi đã có
   đồng bộ gia tăng? "Ưu tiên" áp dụng cho tình huống nào (hiện mỗi lúc chỉ 1 lượt đồng bộ chạy)?
2. Mục tiêu bảo mật ở mục 3.2 là gì — xác nhận hiện trạng (đã đạt) hay muốn thêm mã hóa dữ liệu hóa đơn tại chỗ
   (tính năng mới, cần mật khẩu chủ)?
3. Có chấp nhận bỏ đường chạy qua trình duyệt (Chay-eTax.bat) để chuyển hẳn sang SQLite/Electron không, hay SQLite
   không cần thiết ở giai đoạn này?
4. Xác nhận phạm vi: chỉ làm Phase 1a + 1b trước (rủi ro thấp, khoảng trống thật), hay muốn ưu tiên khác?
