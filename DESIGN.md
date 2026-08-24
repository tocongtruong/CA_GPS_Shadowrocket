---
name: "iOS Location Lab"
description: "Bảng điều khiển vị trí riêng tư, chính xác và trung thực về trạng thái dữ liệu."
colors:
  background-primary: "oklch(0.18 0.018 255)"
  surface: "oklch(0.225 0.02 255)"
  surface-raised: "oklch(0.265 0.022 255)"
  surface-inset: "oklch(0.155 0.014 255)"
  border: "oklch(0.38 0.025 255)"
  border-strong: "oklch(0.5 0.04 250)"
  text-primary: "oklch(0.94 0.012 245)"
  text-secondary: "oklch(0.75 0.025 250)"
  text-muted: "oklch(0.67 0.025 250)"
  accent: "oklch(0.74 0.145 225)"
  accent-hover: "oklch(0.8 0.13 225)"
  accent-ink: "oklch(0.2 0.035 245)"
  success: "oklch(0.77 0.15 155)"
  warning: "oklch(0.82 0.15 82)"
  danger: "oklch(0.69 0.19 24)"
  danger-hover: "oklch(0.75 0.17 24)"
  focus: "oklch(0.84 0.16 95)"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.02em"
rounded:
  sm: "0.45rem"
  md: "0.75rem"
  lg: "1rem"
  pill: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.85rem"
    height: "2.5rem"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.85rem"
    height: "2.5rem"
  input:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0.48rem 0.7rem"
    height: "2.5rem"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "1rem"
  status-pill:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 0.7rem"
    height: "2.5rem"
---

# Design System: iOS Location Lab

## Overview

**Creative North Star: "Bảng điều khiển máy đo tĩnh"**

“Bảng điều khiển máy đo tĩnh” xem giao diện như một dụng cụ kỹ thuật kín đáo: dữ liệu, thời gian và sai số luôn nổi bật hơn trang trí. Bố cục dùng bề mặt tối phân tầng nhẹ, một accent cyan có kiểm soát và ngôn ngữ trạng thái trực tiếp để tạo cảm giác tin cậy, chính xác, bình tĩnh.

Hệ thống tuyệt đối không mang vẻ hacker trang trí, không dùng glassmorphism dày đặc, gradient phô trương hoặc trạng thái xanh giả tạo. Desktop giữ bản đồ và thông tin song song; mobile đặt bản đồ trước, vùng chạm tối thiểu 44 px và không được tràn ngang.

**Key Characteristics:**

- Tối, kín đáo và có độ tương phản cao.
- Cyan dành cho hành động và dữ liệu vị trí, không phủ tràn màn hình.
- Trạng thái luôn có cả màu, nhãn chữ và hướng xử lý.
- Phân tầng bằng sắc độ và đường viền mảnh trước khi dùng bóng đổ.

## Colors

Bảng màu là navy trung tính hơi lạnh với cyan rõ ràng, xanh lá cho thành công thật, vàng cho dữ liệu chưa chắc chắn và đỏ cho lỗi/hành động phá hủy.

### Primary

- **Instrument Cyan** (`accent`, `accent-hover`): hành động chính, tọa độ và liên kết quan trọng.

### Secondary

- **Verified Green** (`success`): chỉ dùng khi tọa độ hoặc thao tác đã thực sự thành công.
- **Diagnostic Amber** (`warning`): dữ liệu cũ, payload thiếu tọa độ và trạng thái cần chú ý.
- **Fault Red** (`danger`, `danger-hover`): lỗi, mất kết nối và thao tác xóa.

### Neutral

- **Quiet Navy** (`background-primary`, `surface-inset`): nền ứng dụng, bản đồ dự phòng và trường nhập.
- **Instrument Surface** (`surface`, `surface-raised`): panel, modal và trạng thái hover.
- **Measured Border** (`border`, `border-strong`): phân nhóm mà không tạo một lưới card nặng nề.
- **Reading White** (`text-primary`, `text-secondary`, `text-muted`): ba cấp độ ưu tiên chữ.

### Named Rules

**The Honest Signal Rule.** Xanh lá bị cấm nếu hệ thống chỉ nhận tín hiệu nhưng chưa có tọa độ hợp lệ; trường hợp đó luôn dùng vàng kèm lời giải thích.

**The Cyan Budget Rule.** Cyan chỉ xuất hiện ở hành động chính, tab được chọn và dữ liệu vị trí; độ hiếm tạo ra thứ bậc.

## Typography

**Display Font:** Không có display font; dashboard không dùng kiểu chữ trình diễn.
**Body Font:** System sans (`-apple-system`, BlinkMacSystemFont, Segoe UI, `system-ui`, sans-serif).

**Character:** Chữ hệ thống cho cảm giác bản địa, tải nhanh và đọc rõ trên iPhone lẫn Windows. Trọng lượng đậm được dùng có chọn lọc cho nhãn điều khiển và số liệu, không dùng cho toàn bộ bề mặt.

### Hierarchy

- **Title** (750, `1rem`, 1.25): tiêu đề panel, modal và tên sản phẩm.
- **Body** (400, `0.8rem`, 1.45): mô tả trạng thái, hướng xử lý và nội dung bảng.
- **Label** (700, `0.72rem`, 1.2): nhãn form, trạng thái, tiêu đề bảng; eyebrow dùng uppercase với tracking rộng hơn.
- **Data value** (700–780, `0.92–1rem`, tabular numerals): tọa độ, quãng đường, tổng điểm và thời gian.

### Named Rules

**The Data First Rule.** Vị trí, thời gian và độ chính xác luôn có trọng lượng hoặc độ tương phản cao hơn nhãn mô tả của chúng.

## Elevation

Hệ thống phẳng theo mặc định. Độ sâu đến từ bốn sắc độ nền và đường viền 1 px; bóng ambient lớn chỉ dành cho modal, thông báo nổi và nút nổi trên bản đồ.

### Shadow Vocabulary

- **Raised Ambient** (`--shadow-raised`): bóng mềm cho nội dung thực sự nổi khỏi luồng trang; không dùng trên mọi panel.
- **Focus Ring** (3 px, `focus`): tín hiệu bàn phím rõ, luôn có offset và không phụ thuộc bóng trang trí.

### Named Rules

**The Flat by Default Rule.** Panel ở trạng thái nghỉ dùng sắc độ và border; nếu mọi card đều có bóng, phân tầng đã thất bại.

## Components

### Buttons

- **Shape:** cạnh cong gọn (`rounded.sm`), cao tối thiểu 2.5 rem và 2.75 rem trên mobile.
- **Primary:** Instrument Cyan với chữ Quiet Navy; chỉ một hành động chính trong mỗi cụm.
- **Hover / Focus:** thay đổi màu trong 180 ms bằng ease-out; focus có vòng 3 px rõ ràng.
- **Secondary / Danger:** secondary dùng bề mặt raised và border; danger là outline đỏ cho tới khi hover.

### Chips

- **Style:** pill có border cùng màu chữ, nền trong suốt hoặc inset.
- **State:** luôn kèm nhãn như “WLOC thiếu tọa độ”; không dùng chấm màu đơn độc để truyền đạt ý nghĩa.

### Cards / Containers

- **Corner Style:** cong vừa (`rounded.md`).
- **Background:** Instrument Surface trên nền Quiet Navy.
- **Shadow Strategy:** phẳng ở trạng thái nghỉ, theo quy tắc Elevation.
- **Border:** một đường Measured Border 1 px.
- **Internal Padding:** 1 rem; khoảng cách giữa panel 0.85–1 rem.

### Inputs / Fields

- **Style:** nền inset, border mạnh, cạnh cong gọn và rộng không vượt container.
- **Focus:** border Focus Yellow và vòng sáng 3 px có opacity thấp.
- **Error / Disabled:** lỗi có chữ đỏ và hướng sửa; disabled giảm opacity nhưng vẫn giữ nhãn đọc được.

### Navigation

Tab nằm trong một thanh inset có border. Tab đang chọn dùng cyan và chữ tối; trên mobile thanh tab chiếm đủ chiều ngang, hai tab chia đều và header chuyển thành ba hàng có trật tự.

### Location State Panel

Đây là component chữ ký: nó tách “tín hiệu mới nhất” khỏi “tọa độ hợp lệ gần nhất”, giữ tọa độ cũ khi cần và giải thích rõ tại sao dữ liệu mới chưa thể đặt marker.

## Do's and Don'ts

### Do:

- **Do** giữ trạng thái trung thực: tín hiệu không có tọa độ phải dùng Diagnostic Amber và nhãn “WLOC thiếu tọa độ”.
- **Do** giữ vùng chạm tối thiểu 44 px, focus 3 px và hỗ trợ `prefers-reduced-motion`.
- **Do** đặt bản đồ trước sidebar ở màn hình hẹp và bảo đảm `scrollWidth` không vượt viewport.
- **Do** dùng border 1 px và tonal layering để phân nhóm dữ liệu.

### Don't:

- **Don't** dùng “giao diện hacker trang trí”.
- **Don't** dùng “glassmorphism dày đặc”.
- **Don't** dùng “gradient phô trương”.
- **Don't** dùng “trạng thái xanh giả tạo” khi chưa có tọa độ hợp lệ.
- **Don't** biến dashboard thành “một lưới card giống nhau”.
- **Don't** ưu tiên thẩm mỹ hơn khả năng đọc dữ liệu.
