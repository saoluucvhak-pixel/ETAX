# eTax Manager — Hướng dẫn cài đặt và sử dụng

eTax Manager giúp kế toán tải hóa đơn điện tử từ cổng Thuế (hoadondientu.gdt.gov.vn) về máy, tra cứu, đối chiếu, lập báo cáo
VAT và xuất Excel/PDF/XML. Dữ liệu lưu ngay trên máy bạn (IndexedDB), không gửi đi đâu khác ngoài cổng Thuế.

Ứng dụng chạy được ba cách với cùng một mã nguồn: **Web**, **PWA** (cài như ứng dụng từ trình duyệt) và **Electron** (ứng dụng máy tính).

## 0. Cách nhanh nhất (khuyên dùng)

Không cần dùng cmd hay gõ lệnh: giải nén, rồi bấm đúp `Chay-eTax.bat`. Xem thêm `BAT-DAU-O-DAY.txt`.

**Windows — bản portable (không cần cài gì):** giải nén `etax-manager-windows-portable.zip` ra một thư mục cố định
(ví dụ `D:\eTax`), bấm đúp **`Chay-eTax.bat`**. Cửa sổ đen hiện ra và trình duyệt tự mở ứng dụng. Dùng xong đóng cửa sổ đen là tắt.
Thư mục `runtime` chứa sẵn `node.exe`. Muốn chắc chắn hơn về nguồn gốc, tải bản Windows Binary (.zip) từ https://nodejs.org,
lấy `node.exe` trong đó chép đè vào `runtime\node.exe`.

**Windows — bản thường:** cài Node.js LTS một lần, rồi bấm đúp `Chay-eTax.bat` như trên.
**macOS / Linux:** cài Node.js LTS, rồi bấm đúp `Chay-eTax.command` (Mac) hoặc chạy `./Chay-eTax.sh` (Linux).

Sang máy khác: chép nguyên thư mục ứng dụng sang máy đó và làm như trên. **Dữ liệu hóa đơn không đi theo thư mục** vì nằm trong
trình duyệt của từng máy: trước khi chuyển hãy *Cài đặt → Sao lưu ngay*, sang máy mới chọn *Khôi phục từ file*.
Luôn mở ứng dụng bằng đúng địa chỉ `http://127.0.0.1:8080` (đổi cổng sẽ thấy kho dữ liệu trống vì dữ liệu tách riêng theo địa chỉ).

Nếu Windows SmartScreen hoặc phần mềm diệt virus cảnh báo `node.exe` / `.bat` chưa được ký: chọn *More info → Run anyway*
(hoặc dùng `node.exe` tải từ nodejs.org như trên).

## 1. Chạy bằng dòng lệnh (Web / PWA)

Cần Node.js 18 trở lên (chỉ để chạy máy chủ cục bộ, không cần cài thư viện nào).

```bash
node server/server.mjs
# mở http://127.0.0.1:8080
```

Máy chủ này làm hai việc: phục vụ giao diện, và chuyển tiếp các yêu cầu `/gdt/*` tới cổng Thuế. Trình duyệt không được gọi thẳng
cổng Thuế (bị chặn CORS), nên **không dùng được với đăng nhập thật nếu chỉ mở file index.html bằng tay**.

Cài như ứng dụng (PWA): mở địa chỉ trên bằng Chrome/Edge, chọn *Cài đặt* trên thanh địa chỉ, hoặc nút "Cài như ứng dụng"
ở chân thanh bên. Sau lần mở đầu tiên, giao diện chạy được cả khi mất mạng (đồng bộ thì vẫn cần mạng).

Tùy chọn (biến môi trường): `PORT=9000` đổi cổng; `ETAX_TARGET=https://…` đổi địa chỉ cổng Thuế;
`ETAX_INSECURE_TLS=1` chỉ dùng khi máy không nhận được chuỗi chứng chỉ của cổng Thuế (có cảnh báo, kém an toàn).
Máy chủ chỉ lắng nghe `127.0.0.1`, máy khác trong mạng không truy cập được.

## 2. Ứng dụng máy tính (Electron)

```bash
npm install
npm run desktop      # chạy thử
npm run dist         # đóng gói bộ cài (Windows/macOS/Linux) vào thư mục dist/
```

Bản Electron gọi cổng Thuế từ tiến trình chính (không bị CORS, không cần máy chủ trung gian), và ghi tệp thẳng vào
"Thư mục lưu" bạn chọn. Xuất PDF ra tệp PDF thật, không qua hộp thoại in.

## 3. Bắt đầu sử dụng

1. **Đăng nhập** — nhập tên đăng nhập (thường là mã số thuế), mật khẩu, rồi **tự đọc mã xác thực trong ảnh và nhập vào**.
   Ứng dụng không giải hay bỏ qua mã xác thực. Mật khẩu và token chỉ nằm trong bộ nhớ của tab, không lưu ổ đĩa, không ghi nhật ký.
   Chưa có tài khoản hoặc chỉ muốn thử: chọn **Dùng dữ liệu mẫu** (hóa đơn giả lập) hoặc **Làm việc ngoại tuyến**.
2. **Đồng bộ dữ liệu** — chọn khoảng ngày, chiều (đầu vào/đầu ra), cấp mã, bộ lọc thêm, rồi *Bắt đầu đồng bộ*.
   Cổng chỉ trả tối đa khoảng một tháng mỗi lần nên ứng dụng tự chia nhỏ và lưu từng trang (bị ngắt giữa chừng vẫn giữ phần đã tải).
   Chế độ *Gia tăng* chỉ tải phần mới từ lần trước (lùi 3 ngày để bắt kịp hóa đơn lập muộn/đổi trạng thái).
3. **Hóa đơn đầu vào / đầu ra** — bảng có sắp xếp (bấm tiêu đề), lọc theo cột (nút *Lọc theo cột*; cột số hỗ trợ `>1000000`,
   `<=500`, `100..200`), tìm nhanh, chọn nhiều (Shift chọn khoảng, Ctrl+A chọn tất cả), dòng tổng ở chân bảng. Bấm một dòng để xem chi tiết.
4. **Chi tiết hóa đơn** — thông tin chung, người bán/mua, hàng hóa, thuế, thanh toán, đính kèm XML/PDF, ghi chú.
   Danh sách đồng bộ chỉ có tổng tiền; bấm *Tải chi tiết từ cổng Thuế* để lấy dòng hàng hóa.
5. **Tra cứu** — tìm theo số, ký hiệu, MST, tên, khoảng ngày, khoảng tiền, trạng thái, không phân biệt dấu. Phím `/` để nhảy vào ô tìm nhanh.
6. **XML / PDF / Excel** — nhập XML (hoặc ZIP chứa XML) có kiểm tra cấu trúc, tổng tiền, chữ ký số; ghép PDF gốc vào hóa đơn theo số hóa đơn trong tên tệp;
   nhập Excel/CSV với ghép cột tự động theo tiêu đề tiếng Việt; xuất Excel/CSV/JSON/PDF.
7. **Báo cáo** — doanh thu, thuế GTGT (theo thuế suất và theo kỳ), khách hàng, nhà cung cấp; theo tháng/quý/năm; xuất Excel nhiều sheet hoặc PDF.
8. **Đối chiếu** — hai tab:
   - **3 nguồn: Sổ sách ↔ HĐĐT Cục Thuế ↔ Tờ khai 01/GTGT (XML)**. Chọn *Mua vào* hoặc *Bán ra*; nạp sổ sách (Excel `.xlsx`), HĐĐT (dữ liệu đã đồng bộ trong máy, hoặc một/nhiều tệp Excel tải từ cổng Thuế — không mã / có mã / máy tính tiền) và tờ khai XML từ HTKK (không bắt buộc).
     Tự dò dòng tiêu đề và cột (sửa lại được), bật/tắt từng sheet. Khóa đối chiếu: Số chứng từ → Ký hiệu + Số hóa đơn → Số hóa đơn; ký hiệu bỏ chữ số mẫu ở đầu; giá trị = chưa thuế − chiết khấu;
     trùng khóa trong cùng sheet thì cộng dồn, trùng giữa các sheet/tệp chỉ lấy một lần (cảnh báo nếu khác giá trị); ghép bổ sung theo Số HĐ + Tên + Ngày; báo *Sai ký hiệu* và *Thiếu ký hiệu*.
     Kết quả: so theo chỉ tiêu tờ khai (khai − HĐĐT và sổ − HĐĐT), bảng từng hóa đơn tô màu (xanh khớp, vàng lệch, đỏ chỉ có một bên, vàng đất sai ký hiệu), xuất Excel nhiều sheet có tô màu. Có tệp mẫu để tải.
     Thẻ `ctNN` trong XML có thể không trùng số chỉ tiêu in trên tờ khai ở mọi doanh nghiệp; nếu số khác tờ khai giấy, chọn cặp thẻ khác ở mục *Chỉ tiêu tờ khai*.
   - **So sổ với hóa đơn đã đồng bộ (theo MST)**: ghép theo MST + ký hiệu + số; có thêm nhóm hủy/bị thay thế, máy tính tiền (`C26Mxx`), đối tác "thường gặp" (ngân hàng, bảo hiểm), lệch kỳ.
9. **Nhật ký** — đăng nhập, đồng bộ, tìm kiếm, xuất/nhập, sao lưu, lỗi, kèm thời gian thực hiện.
10. **Cài đặt** — giao diện sáng/tối, ngôn ngữ, tự động đồng bộ, thư mục lưu, kênh kết nối, nhiều doanh nghiệp/tài khoản, sao lưu/khôi phục/đặt lại.

## 3a. Đăng nhập bằng trang Thuế (khuyên dùng) — nối tự động với tiện ích trình duyệt

Cách này để **chính bạn đăng nhập trên trang hoadondientu.gdt.gov.vn** (tự nhập mật khẩu và mã xác thực). Tiện ích chạy ngay trong trang đó, **tự nhận lệnh từ eTax Manager**, tải danh sách hóa đơn và XML gốc rồi chuyển về máy bạn.
Mật khẩu và token của trang Thuế **không** đi qua eTax Manager; tiện ích chỉ chuyển dữ liệu hóa đơn về máy bạn.

1. **Cài tiện ích (một lần):** trong Chrome/Edge gõ `chrome://extensions` (Edge: `edge://extensions`) → bật *Chế độ nhà phát triển* → *Tải tiện ích đã giải nén* → chọn thư mục `extension` trong thư mục eTax (cùng chỗ với `Chay-eTax.bat`). **Chỉ cài MỘT tiện ích eTax**: nếu trước đó đã cài bản cũ (hoặc thư mục `etax-tai-hoa-don`), hãy xóa nó ở trang `chrome://extensions` rồi mới cài bản này, kẻo trang Thuế hiện hai hộp và bị gọi trùng. Xem thêm `extension/HUONG-DAN.txt`.
2. Mở eTax Manager bằng `Chay-eTax.bat` → trang **Đăng nhập** → bấm **Mở trang Thuế** → tự đăng nhập ở trang đó, rồi vào menu **Tra cứu → Tra cứu hóa đơn** và **để tab đó mở**.
3. Quay lại eTax Manager: khi ba dòng báo *Đã có*, bấm **Dùng phiên này để đồng bộ**.
4. Ở **Đồng bộ dữ liệu** chọn kỳ (tick **Tải kèm XML gốc và chi tiết hàng hóa** nếu cần; ô **Lấy thêm hóa đơn khởi tạo từ máy tính tiền** được tick sẵn, bỏ tick nếu không cần) → **Bắt đầu đồng bộ**. Không cần bấm gì ở trang Thuế: tiện ích tự nhận lệnh và chạy lần lượt mua vào rồi bán ra, dữ liệu về eTax Manager ngay khi tải. (Muốn tự bấm "Chạy" cho từng lệnh: bỏ tick **Tự chạy khi eTax Manager ra lệnh** trong hộp tiện ích.)

Cách hoạt động và giới hạn:
- Tiện ích gọi API **đúng như chính trang Thuế gọi**: cùng địa chỉ, cùng định dạng tham số (`size=15`, phân trang bằng `state`) và cùng bộ header mô tả thao tác (`Action`, `End-Point`, `request-id`, `Accept-Language`); từng đoạn ≤ 31 ngày, cách nhau khoảng 1 giây. Bản tiện ích cũ thiếu các header này nên bị cổng Thuế chặn ("hành vi không hợp lệ"). **Nếu cổng Thuế vẫn chặn (hoặc phiên hết hạn) tiện ích dừng ngay và báo rõ**, không thử cách khác để né; khi đó chờ một lúc hoặc dùng cách tải Excel ở mục 3b.
- Có tick XML: mỗi hóa đơn tốn thêm ~1 giây (1.000 hóa đơn ≈ 20 phút). XML gốc được lưu kèm hóa đơn và **bổ sung chi tiết hàng hóa**; trạng thái hóa đơn (ví dụ đã hủy) lấy từ danh sách của cổng, không bị XML ghi đè.
- Mua vào chọn "cả có mã và không mã" thì tiện ích chạy lần lượt *đã cấp mã* rồi *không mã* (cổng bắt buộc chọn kết quả kiểm tra).
- Chỉ dùng được với bản chạy bằng `Chay-eTax.bat` (máy chủ cục bộ), chưa hỗ trợ bản Electron. Hóa đơn máy tính tiền (mua vào và bán ra, kèm XML) đã được hỗ trợ; trong tiện ích dùng riêng chọn "Mua vào - máy tính tiền" / "Bán ra - máy tính tiền".
- Đã kiểm chứng với cổng Thuế thật (20/09/2026): cách gọi tìm kiếm mua vào/bán ra, phân trang, xuất XML (cổng trả file ZIP chứa XML và HTML), xem chi tiết. Đã chạy thử đầu-cuối trọn luồng nối eTax trên cổng giả nghiêm ngặt (`tests/extension_bridge_e2e.py`). Hóa đơn máy tính tiền cũng đã đo trên cổng thật: danh sách `/api/sco-query/invoices/{sold|purchase}` (không lọc mã/không mã), xuất XML `/api/sco-query/invoices/export-xml` (ZIP), `Action` dạng "Tìm kiếm (hóa đơn máy tính tiền bán ra)". Nhãn `Action` xuất XML **bán ra** thường có trong mã nguồn trang Thuế nhưng chưa có hóa đơn mẫu để gọi thử (công ty đang dùng chỉ bán ra qua máy tính tiền).

## 3b. Không đăng nhập được cổng Thuế thì làm gì

Cổng Thuế thường từ chối đăng nhập trực tiếp từ chương trình (thông báo "hành vi không hợp lệ"; mục *Cách cũ* ở trang Đăng nhập) (thông báo "hành vi không hợp lệ"). Khi đó vẫn dùng đầy đủ được:
tải Excel (và XML nếu cần) bằng chính trang cổng Thuế trên trình duyệt, rồi nhập vào ứng dụng. Ở mục **Excel**, khung *Nhập nhiều tệp Excel tải từ cổng Thuế* nhận **tất cả các tệp một lượt** (mua vào, bán ra, máy tính tiền): tự nhận chiều theo mã số thuế doanh nghiệp, hiện kỳ và số hóa đơn từng tệp, nhập lại không nhân đôi. Mục **Excel** đọc đúng bố cục tệp xuất từ cổng
(ngày dạng chữ dd/mm/yyyy, cột chiết khấu, trạng thái bằng chữ), mục **Đối chiếu** nạp thẳng nhiều tệp (không mã / có mã / máy tính tiền), mục **XML** nhập tệp XML hóa đơn.

## 4. Lưu ý về số liệu

- Hóa đơn **hủy** và **đã bị thay thế** không được tính vào doanh số và thuế. Hóa đơn điều chỉnh giảm (giá trị âm) được cộng đúng dấu.
- "Thuế GTGT tạm tính" chỉ là đầu ra trừ đầu vào của các hóa đơn đã lưu trong kỳ. Chưa gồm số thuế được khấu trừ kỳ trước,
  hàng hóa không đủ điều kiện khấu trừ, điều chỉnh… Số kê khai chính thức theo tờ khai.
- PDF do ứng dụng xuất là **bản thể hiện** dựng từ dữ liệu đã lưu, không thay thế hóa đơn gốc có chữ ký số.
- Hóa đơn đầu vào/đầu ra nào có MST doanh nghiệp không khớp sẽ được gán chiều theo lựa chọn của bạn khi nhập XML/Excel.

## 5. Sao lưu

*Cài đặt → Sao lưu ngay* tạo một tệp `.json` gồm toàn bộ dữ liệu (trừ mật khẩu/token). Nên sao lưu định kỳ vì dữ liệu chỉ nằm trên máy;
xóa dữ liệu trình duyệt hoặc *Đặt lại ứng dụng* sẽ mất hết. Khôi phục có chế độ *Gộp* hoặc *Thay thế*.

## 6. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| "Trình duyệt không thể gọi thẳng cổng Thuế (bị chặn CORS)" | Chạy `node server/server.mjs` và mở ứng dụng qua địa chỉ đó, hoặc dùng bản Electron |
| Không tải được mã xác thực | Kiểm tra mạng; bấm *Đổi mã*. Xem trang Nhật ký để biết lỗi chi tiết |
| Lỗi chứng chỉ TLS (máy chủ trung gian báo 502) | Cập nhật hệ điều hành/Node.js; nếu vẫn lỗi, chạy với `ETAX_INSECURE_TLS=1` và hiểu rủi ro |
| Sai mật khẩu/mã xác thực | Mã xác thực chỉ dùng một lần; sau mỗi lần thất bại ứng dụng tự tải mã mới |
| "Phiên đăng nhập đã hết hạn" | Đăng nhập lại; dữ liệu đã đồng bộ vẫn còn |
| Không mở được ứng dụng ở chế độ ẩn danh | Trình duyệt chặn IndexedDB; dùng cửa sổ thường |
| Đăng nhập báo "Hệ thống phát hiện hành vi không hợp lệ. Yêu cầu đã bị chặn." | Đây là lớp chống truy cập tự động của cổng Thuế, **không phải sai mật khẩu/mã xác thực**. Ứng dụng không cố vượt qua lớp chặn này và không thử lại. Đừng bấm đăng nhập liên tục. Dùng cách tải thủ công: vào https://hoadondientu.gdt.gov.vn bằng trình duyệt → Tra cứu hóa đơn → chọn khoảng ngày → Xuất Excel (mua vào, bán ra riêng), rồi nhập ở mục **Excel** hoặc nạp thẳng ở mục **Đối chiếu** |
| Không tải được mã xác thực, báo `HTTP 502 … ECONNREFUSED …:30000` | Cổng riêng :30000 không còn nhận kết nối từ máy bạn. Ứng dụng tự thử thêm cách đặt đường dẫn mới (`/api` trên tên miền chính). Bấm *Kiểm tra kết nối cổng Thuế* (trang Đăng nhập) hoặc *Cài đặt → Kết nối cổng Thuế → Kiểm tra kết nối* để xem cách nào chạy được. Nếu cả hai đều lỗi: mở https://hoadondientu.gdt.gov.vn trong trình duyệt — không vào được thì là do mạng (VPN, tường lửa công ty, nhà mạng) hoặc cổng đang bảo trì |
| Cổng Thuế đổi địa chỉ/cấu trúc | *Cài đặt → Kết nối cổng Thuế → Địa chỉ API* chọn *Tùy chỉnh* rồi nhập địa chỉ gốc + tiền tố; hoặc sửa `GDT_PROFILES`/`GDT` trong `js/config.js`; logic chuẩn hóa nằm ở `js/core/normalizer.js` |

## 7. Cấu trúc mã nguồn

```
index.html  manifest.json  sw.js
css/        theme.css (màu, chữ, sáng/tối) · style.css (khung, thành phần) · views.css (bảng, biểu đồ, từng trang)
js/         app.js  config.js  utils.js  storage.js  logger.js  api.js  export.js
            login.js  dashboard.js  sync.js  invoice.js  invoiceDetail.js  report.js
js/views/   lookup  xmlView  pdfView  excelView  reconcile  partners  logs  settings
js/core/    state  router  shell  ui  datagrid  charts  i18n  settings  companies  platform
            normalizer  xmlparser  xlsx  zip  reports  reconcile  invoiceStore  invoiceGrid  syncEngine  autosync  backup  demo  dropzone
extension/  tiện ích Chrome/Edge (cầu nối trang Thuế)
server/     server.mjs (máy chủ cục bộ + chuyển tiếp + cầu nối tiện ích)      electron/  main.cjs, preload.cjs
database/   schema.md      docs/  tài liệu này      tests/  smoke.py, functional.py (Playwright)
```

Không dùng React/Vue/Angular và không có thư viện bên thứ ba lúc chạy: ZIP, XLSX, biểu đồ, Data Grid ảo hóa đều tự viết.
Không tệp nào quá 700 dòng.

## 8. Kiểm thử

```bash
node server/server.mjs &
pip install playwright && playwright install chromium
python3 tests/smoke.py        # chạy toàn bộ luồng ở chế độ dữ liệu mẫu, thu lỗi console, chụp ảnh
python3 tests/extension_e2e.py   # tiện ích trình duyệt thật + cổng giả (cần mock JWT=1 và bản sao extension thêm https://127.0.0.1/* vào manifest)
python3 tests/functional.py   # tra cứu, báo cáo, xuất/nhập Excel, nhập XML, sao lưu, giao diện tối, di động
python3 tests/reconcile3_diff.py <DoiChieuThueGTGT_full.html>   # so kết quả đối chiếu 3 nguồn với công cụ HTML gốc trên dữ liệu ngẫu nhiên
```

## 9. Giới hạn cần biết

- Cổng Thuế không công bố API chính thức. Ứng dụng tự dò hai cách đặt địa chỉ (`/api` trên tên miền chính, và cổng riêng `:30000`) nhưng cả hai đều **chưa được kiểm chứng trên cổng thật** (xem dưới). Các đường dẫn API của cổng Thuế trong `js/config.js` dựa trên API công khai mà cổng tra cứu đang dùng. Phần gọi cổng thật
  (đăng nhập, danh sách, chi tiết, tải XML) **chưa được kiểm chứng trên cổng thật** trong môi trường phát triển vì không có kết nối tới cổng;
  mọi luồng khác đã chạy thử đầy đủ ở chế độ dữ liệu mẫu. Nếu cổng trả cấu trúc khác, sửa `config.js` và `normalizer.js`.
- Cổng Thuế có thể yêu cầu mã xác thực/khóa phiên theo cách khác theo thời gian; ứng dụng không né tránh cơ chế này.
- Tải hàng hóa chi tiết cho hàng chục nghìn hóa đơn sẽ rất chậm (mỗi hóa đơn một lượt gọi, có giãn cách để không quá tải cổng).
