// Theme.swift — §3.1 컬러 토큰 + §3.2 타이포 + §3.3 사이즈/패딩.
//
// Windows 측 다이얼로그와 시각적으로 동일하게 가기 위한 상수.
// 값 변경 시 양쪽 동시 합의 필요.

import SwiftUI

public enum Theme {

    // MARK: — Colors (§3.1)

    public static let surface     = Color(hex: 0x1B1B22) // 본문 배경
    public static let surface2    = Color(hex: 0x26262E) // 카드/입력 배경
    public static let surfaceLow  = Color(hex: 0x13131A) // 헤더/푸터 배경
    public static let textPri     = Color(hex: 0xF0F0F5) // 주요 텍스트
    public static let textSec     = Color(hex: 0x9090A0) // 보조 텍스트
    public static let accent      = Color(hex: 0x0A84FF) // iOS system blue
    public static let accentHi    = Color(hex: 0x369AFF) // accent hover
    public static let border1     = Color(hex: 0x33333D) // 카드/입력 테두리
    public static let danger      = Color(hex: 0xFF453A) // 닫기 버튼 hover
    public static let success     = Color(hex: 0x30D158) // 성공 뱃지

    // MARK: — Typography (§3.2)

    public enum Typography {
        // Mac에서 SF Pro Text + Apple SD Gothic Neo는 system font에 포함.
        public static func title()   -> Font { .system(size: 14, weight: .semibold) }
        public static func body()    -> Font { .system(size: 13, weight: .regular) }
        public static func caption() -> Font { .system(size: 11, weight: .semibold) }
        public static func mono()    -> Font { .system(size: 11, weight: .regular, design: .monospaced) }
    }

    // MARK: — Layout (§3.3)

    public enum Layout {
        public static let dialogWidth:    CGFloat = 510
        public static let headerHeight:   CGFloat = 50
        public static let footerHeight:   CGFloat = 50
        public static let bodyPaddingH:   CGFloat = 26
        public static let bodyPaddingV:   CGFloat = 20
        public static let cardPaddingH:   CGFloat = 15
        public static let cardPaddingV:   CGFloat = 13
        public static let cardCorner:     CGFloat = 8
        public static let outerCorner:    CGFloat = 14
        public static let buttonPaddingH: CGFloat = 22
        public static let buttonPaddingV: CGFloat = 11
        public static let buttonCorner:   CGFloat = 7
    }

    // MARK: — Shadow (§2.2)

    public enum Shadow {
        public static let blur:    CGFloat = 28
        public static let opacity: Double  = 0.55
    }

    // MARK: — NSColor 변환 (AppKit 인터럽 — DragView 등에서 사용)

    public enum NS {
        public static let surfaceLow = NSColor(red: 0x13/255, green: 0x13/255,
                                               blue: 0x1A/255, alpha: 1)
        public static let surface    = NSColor(red: 0x1B/255, green: 0x1B/255,
                                               blue: 0x22/255, alpha: 1)
        public static let surface2   = NSColor(red: 0x26/255, green: 0x26/255,
                                               blue: 0x2E/255, alpha: 1)
    }
}

private extension Color {
    /// 0xRRGGBB hex → sRGB Color. 디자인 토큰 가독성 위해 정수 리터럴 받음.
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8)  & 0xFF) / 255.0
        let b = Double( hex        & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1.0)
    }
}
