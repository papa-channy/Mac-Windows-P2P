# _send-dialog.ps1 — WPF dialogs for Mac-Window_Share Send-to-Mac flow.
# Dot-sourced by send-to-mac.ps1. Exposes:
#   Show-CategoryDialog  -> [string]|$null  (category key, or $null if cancelled)
#   Show-ResultDialog    -> [void]

Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue | Out-Null
Add-Type -AssemblyName PresentationCore      -ErrorAction SilentlyContinue | Out-Null
Add-Type -AssemblyName WindowsBase           -ErrorAction SilentlyContinue | Out-Null

function _LoadWindowIcon([System.Windows.Window]$Window, [string]$IconPath, [System.Windows.Controls.Image]$HeaderImg) {
    if (-not $IconPath) { return }
    if (-not (Test-Path -LiteralPath $IconPath)) { return }
    $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit()
    $bmp.UriSource   = New-Object Uri((Resolve-Path -LiteralPath $IconPath).Path, [UriKind]::Absolute)
    $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bmp.EndInit()
    $bmp.Freeze()
    $Window.Icon = $bmp
    if ($HeaderImg) { $HeaderImg.Source = $bmp }
}

function Show-CategoryDialog {
    param(
        [Parameter(Mandatory)] [System.IO.FileSystemInfo] $Item,
        [string] $DefaultCategory = 'documents',
        [string] $IconPath
    )

    $isDir = $Item.PSIsContainer
    if ($isDir) {
        $fileCount = try { (Get-ChildItem -LiteralPath $Item.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count } catch { 0 }
        $sizeText  = "폴더 · ${fileCount} 파일"
        $kindEmoji = "📁"
    } else {
        $bytes = $Item.Length
        $sizeText = if ($bytes -ge 1MB) { '{0:N1} MB' -f ($bytes/1MB) }
                    elseif ($bytes -ge 1KB) { '{0:N1} KB' -f ($bytes/1KB) }
                    else { "$bytes bytes" }
        $kindEmoji = "📄"
    }

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="MacBook으로 보내기" Width="520" SizeToContent="Height"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        WindowStartupLocation="CenterScreen" ShowInTaskbar="True" Topmost="True"
        FontFamily="Segoe UI, Malgun Gothic">
  <Window.Resources>
    <SolidColorBrush x:Key="Surface"    Color="#1B1B22"/>
    <SolidColorBrush x:Key="Surface2"   Color="#26262E"/>
    <SolidColorBrush x:Key="SurfaceLow" Color="#13131A"/>
    <SolidColorBrush x:Key="TextPri"    Color="#F0F0F5"/>
    <SolidColorBrush x:Key="TextSec"    Color="#9090A0"/>
    <SolidColorBrush x:Key="Accent"     Color="#0A84FF"/>
    <SolidColorBrush x:Key="AccentHi"   Color="#369AFF"/>
    <SolidColorBrush x:Key="Border1"    Color="#33333D"/>

    <Style TargetType="TextBlock">
      <Setter Property="Foreground" Value="{StaticResource TextPri}"/>
      <Setter Property="TextOptions.TextFormattingMode" Value="Display"/>
    </Style>
    <Style x:Key="Caption" TargetType="TextBlock">
      <Setter Property="Foreground" Value="{StaticResource TextSec}"/>
      <Setter Property="FontSize"   Value="11"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Margin"     Value="0,0,0,8"/>
    </Style>
    <Style x:Key="Primary" TargetType="Button">
      <Setter Property="Background" Value="{StaticResource Accent}"/>
      <Setter Property="Foreground" Value="White"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="FontSize"   Value="13"/>
      <Setter Property="Cursor"     Value="Hand"/>
      <Setter Property="Padding"    Value="22,11"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border Background="{TemplateBinding Background}" CornerRadius="7" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
      <Style.Triggers>
        <Trigger Property="IsMouseOver" Value="True">
          <Setter Property="Background" Value="{StaticResource AccentHi}"/>
        </Trigger>
      </Style.Triggers>
    </Style>
    <Style x:Key="Ghost" TargetType="Button">
      <Setter Property="Background"  Value="Transparent"/>
      <Setter Property="Foreground"  Value="{StaticResource TextSec}"/>
      <Setter Property="FontWeight"  Value="SemiBold"/>
      <Setter Property="FontSize"    Value="13"/>
      <Setter Property="Cursor"      Value="Hand"/>
      <Setter Property="Padding"     Value="22,11"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Bd" Background="{TemplateBinding Background}" CornerRadius="7" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Bd" Property="Background" Value="#2A2A33"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="CloseBtnStyle" TargetType="Button">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Foreground" Value="{StaticResource TextSec}"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Width"  Value="34"/>
      <Setter Property="Height" Value="34"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Cursor"   Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Bd" Background="{TemplateBinding Background}" CornerRadius="6">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Bd" Property="Background" Value="#FF453A"/>
                <Setter Property="Foreground" Value="White"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="ComboTBStyle" TargetType="ToggleButton">
      <Setter Property="Background" Value="{StaticResource Surface2}"/>
      <Setter Property="Foreground" Value="{StaticResource TextPri}"/>
      <Setter Property="BorderBrush" Value="{StaticResource Border1}"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ToggleButton">
            <Border x:Name="Bd" Background="{TemplateBinding Background}" CornerRadius="7"
                    BorderThickness="{TemplateBinding BorderThickness}" BorderBrush="{TemplateBinding BorderBrush}">
              <Grid>
                <Grid.ColumnDefinitions>
                  <ColumnDefinition Width="*"/>
                  <ColumnDefinition Width="34"/>
                </Grid.ColumnDefinitions>
                <ContentPresenter Grid.Column="0" Margin="14,0,0,0" VerticalAlignment="Center" HorizontalAlignment="Left"/>
                <Path Grid.Column="1" Data="M 0,0 L 5,5 L 10,0" Stroke="{StaticResource TextSec}" StrokeThickness="1.6"
                      HorizontalAlignment="Center" VerticalAlignment="Center"/>
              </Grid>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Bd" Property="BorderBrush" Value="{StaticResource TextSec}"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style TargetType="ComboBox">
      <Setter Property="Background" Value="{StaticResource Surface2}"/>
      <Setter Property="Foreground" Value="{StaticResource TextPri}"/>
      <Setter Property="FontSize"   Value="13"/>
      <Setter Property="Height"     Value="46"/>
      <Setter Property="BorderBrush" Value="{StaticResource Border1}"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ComboBox">
            <Grid>
              <ToggleButton Style="{StaticResource ComboTBStyle}"
                            IsChecked="{Binding IsDropDownOpen, Mode=TwoWay, RelativeSource={RelativeSource TemplatedParent}}"
                            ClickMode="Press" Focusable="False"/>
              <ContentPresenter Margin="14,0,34,0" VerticalAlignment="Center" HorizontalAlignment="Left"
                                Content="{TemplateBinding SelectionBoxItem}"
                                ContentTemplate="{TemplateBinding SelectionBoxItemTemplate}"
                                IsHitTestVisible="False"/>
              <Popup IsOpen="{TemplateBinding IsDropDownOpen}" Placement="Bottom" AllowsTransparency="True" PopupAnimation="Slide">
                <Border Background="{StaticResource Surface2}" BorderThickness="1" BorderBrush="{StaticResource Border1}"
                        CornerRadius="7" Margin="0,6,0,0"
                        MinWidth="{Binding ActualWidth, RelativeSource={RelativeSource TemplatedParent}}">
                  <ScrollViewer MaxHeight="320">
                    <ItemsPresenter/>
                  </ScrollViewer>
                </Border>
              </Popup>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style TargetType="ComboBoxItem">
      <Setter Property="Foreground" Value="{StaticResource TextPri}"/>
      <Setter Property="FontSize"   Value="13"/>
      <Setter Property="Padding"    Value="14,11"/>
      <Setter Property="Cursor"     Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ComboBoxItem">
            <Border x:Name="Bd" Background="Transparent" Padding="{TemplateBinding Padding}">
              <ContentPresenter/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsHighlighted" Value="True">
                <Setter TargetName="Bd" Property="Background" Value="#2D2D38"/>
              </Trigger>
              <Trigger Property="IsSelected" Value="True">
                <Setter TargetName="Bd" Property="Background" Value="#1F2A3E"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>

  <Border CornerRadius="14" Background="{StaticResource Surface}" Margin="22">
    <Border.Effect>
      <DropShadowEffect Color="Black" Opacity="0.55" BlurRadius="28" ShadowDepth="0"/>
    </Border.Effect>
    <Grid>
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <Border Grid.Row="0" Background="{StaticResource SurfaceLow}" CornerRadius="14,14,0,0" x:Name="HeaderBar">
        <Grid>
          <Grid.ColumnDefinitions>
            <ColumnDefinition Width="Auto"/>
            <ColumnDefinition Width="*"/>
            <ColumnDefinition Width="Auto"/>
          </Grid.ColumnDefinitions>
          <Image Grid.Column="0" x:Name="HeaderIcon" Width="24" Height="24" Margin="18,14,0,14"
                 RenderOptions.BitmapScalingMode="HighQuality"/>
          <TextBlock Grid.Column="1" Text="MacBook으로 보내기" FontSize="14" FontWeight="SemiBold"
                     VerticalAlignment="Center" Margin="12,0,0,0"/>
          <Button Grid.Column="2" x:Name="CloseBtn" Content="✕" Style="{StaticResource CloseBtnStyle}" Margin="0,0,10,0"/>
        </Grid>
      </Border>

      <StackPanel Grid.Row="1" Margin="26,22,26,18">
        <TextBlock Text="전송 대상" Style="{StaticResource Caption}"/>
        <Border Background="{StaticResource Surface2}" CornerRadius="8" Padding="16,14"
                BorderThickness="1" BorderBrush="{StaticResource Border1}">
          <StackPanel Orientation="Horizontal">
            <TextBlock x:Name="KindIcon" FontSize="26" VerticalAlignment="Center"/>
            <StackPanel Margin="14,0,0,0" VerticalAlignment="Center">
              <TextBlock x:Name="SourceName" FontSize="13" FontWeight="SemiBold"
                         TextTrimming="CharacterEllipsis" MaxWidth="400"/>
              <TextBlock x:Name="SourceMeta" Foreground="{StaticResource TextSec}" FontSize="11"
                         Margin="0,3,0,0" TextTrimming="CharacterEllipsis" MaxWidth="400"/>
            </StackPanel>
          </StackPanel>
        </Border>

        <TextBlock Text="카테고리" Style="{StaticResource Caption}" Margin="0,20,0,8"/>
        <ComboBox x:Name="CategoryCombo"/>
      </StackPanel>

      <Border Grid.Row="2" Background="{StaticResource SurfaceLow}" CornerRadius="0,0,14,14">
        <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="18,14">
          <Button x:Name="CancelBtn" Content="취소" Style="{StaticResource Ghost}" Margin="0,0,10,0"/>
          <Button x:Name="SendBtn"   Content="MacBook으로 전송" Style="{StaticResource Primary}" IsDefault="True"/>
        </StackPanel>
      </Border>
    </Grid>
  </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $window = [Windows.Markup.XamlReader]::Load($reader)

    $headerIcon = $window.FindName('HeaderIcon')
    $kindIconTB = $window.FindName('KindIcon')
    $sourceName = $window.FindName('SourceName')
    $sourceMeta = $window.FindName('SourceMeta')
    $combo      = $window.FindName('CategoryCombo')
    $closeBtn   = $window.FindName('CloseBtn')
    $cancelBtn  = $window.FindName('CancelBtn')
    $sendBtn    = $window.FindName('SendBtn')
    $headerBar  = $window.FindName('HeaderBar')

    _LoadWindowIcon -Window $window -IconPath $IconPath -HeaderImg $headerIcon

    $kindIconTB.Text = $kindEmoji
    $sourceName.Text = $Item.Name
    $sourceMeta.Text = "$sizeText  ·  $($Item.FullName)"

    $cats = @(
        [pscustomobject]@{ Key='documents';    Label='문서';     Folder='30_Documents';    Emoji='📄' }
        [pscustomobject]@{ Key='data';         Label='데이터';   Folder='20_Data';         Emoji='📊' }
        [pscustomobject]@{ Key='repos';        Label='코드';     Folder='10_Repos';        Emoji='💻' }
        [pscustomobject]@{ Key='research';     Label='리서치';   Folder='40_Research';     Emoji='🔬' }
        [pscustomobject]@{ Key='env';          Label='환경설정'; Folder='50_Env';          Emoji='⚙' }
        [pscustomobject]@{ Key='builds';       Label='빌드';     Folder='60_Builds';       Emoji='🛠' }
        [pscustomobject]@{ Key='assets';       Label='애셋';     Folder='70_Assets';       Emoji='🎨' }
        [pscustomobject]@{ Key='misc';         Label='기타';     Folder='90_Misc';         Emoji='📦' }
        [pscustomobject]@{ Key='unclassified'; Label='미분류';   Folder='99_Unclassified'; Emoji='❔' }
    )
    foreach ($c in $cats) {
        $cbi = New-Object System.Windows.Controls.ComboBoxItem
        $cbi.Content = "$($c.Emoji)   $($c.Label)"
        $cbi.Tag = $c
        [void]$combo.Items.Add($cbi)
        if ($c.Key -eq $DefaultCategory) { $combo.SelectedItem = $cbi }
    }
    if (-not $combo.SelectedItem) { $combo.SelectedIndex = 0 }

    $headerBar.Add_MouseLeftButtonDown({ $window.DragMove() })
    $closeBtn.Add_Click({  $window.DialogResult = $false; $window.Close() })
    $cancelBtn.Add_Click({ $window.DialogResult = $false; $window.Close() })
    $sendBtn.Add_Click({
        if ($combo.SelectedItem) { $window.DialogResult = $true }
        $window.Close()
    })
    $window.Add_KeyDown({
        if ($_.Key -eq 'Escape') { $window.DialogResult = $false; $window.Close() }
    })

    $ok = $window.ShowDialog()
    if ($ok -and $combo.SelectedItem) { return $combo.SelectedItem.Tag.Key }
    return $null
}

function Show-ResultDialog {
    param(
        [Parameter(Mandatory)] [string] $Filename,
        [Parameter(Mandatory)] [string] $Category,
        [Parameter(Mandatory)] [string] $Sha256,
        [string] $IconPath
    )

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="전송 완료" Width="500" SizeToContent="Height"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        WindowStartupLocation="CenterScreen" ShowInTaskbar="True" Topmost="True"
        FontFamily="Segoe UI, Malgun Gothic">
  <Window.Resources>
    <SolidColorBrush x:Key="Surface"    Color="#1B1B22"/>
    <SolidColorBrush x:Key="Surface2"   Color="#26262E"/>
    <SolidColorBrush x:Key="SurfaceLow" Color="#13131A"/>
    <SolidColorBrush x:Key="TextPri"    Color="#F0F0F5"/>
    <SolidColorBrush x:Key="TextSec"    Color="#9090A0"/>
    <SolidColorBrush x:Key="Accent"     Color="#0A84FF"/>
    <SolidColorBrush x:Key="AccentHi"   Color="#369AFF"/>
    <SolidColorBrush x:Key="Success"    Color="#30D158"/>
    <SolidColorBrush x:Key="Border1"    Color="#33333D"/>

    <Style TargetType="TextBlock">
      <Setter Property="Foreground" Value="{StaticResource TextPri}"/>
      <Setter Property="TextOptions.TextFormattingMode" Value="Display"/>
    </Style>
    <Style x:Key="Primary" TargetType="Button">
      <Setter Property="Background" Value="{StaticResource Accent}"/>
      <Setter Property="Foreground" Value="White"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="FontSize"   Value="13"/>
      <Setter Property="Cursor"     Value="Hand"/>
      <Setter Property="Padding"    Value="22,11"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border Background="{TemplateBinding Background}" CornerRadius="7" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
      <Style.Triggers>
        <Trigger Property="IsMouseOver" Value="True">
          <Setter Property="Background" Value="{StaticResource AccentHi}"/>
        </Trigger>
      </Style.Triggers>
    </Style>
  </Window.Resources>

  <Border CornerRadius="14" Background="{StaticResource Surface}" Margin="22">
    <Border.Effect>
      <DropShadowEffect Color="Black" Opacity="0.55" BlurRadius="28" ShadowDepth="0"/>
    </Border.Effect>
    <Grid>
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <Border Grid.Row="0" Background="{StaticResource SurfaceLow}" CornerRadius="14,14,0,0" x:Name="HeaderBar">
        <Grid Margin="22,18">
          <Grid.ColumnDefinitions>
            <ColumnDefinition Width="Auto"/>
            <ColumnDefinition Width="*"/>
          </Grid.ColumnDefinitions>
          <Border Grid.Column="0" Width="42" Height="42" CornerRadius="21" Background="#1F3A23">
            <TextBlock Text="✓" FontSize="22" FontWeight="Bold" Foreground="{StaticResource Success}"
                       HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
          <StackPanel Grid.Column="1" VerticalAlignment="Center" Margin="14,0,0,0">
            <TextBlock Text="전송 완료" FontSize="15" FontWeight="SemiBold"/>
            <TextBlock Text="MacBook이 공유폴더에서 받을 수 있어요"
                       Foreground="{StaticResource TextSec}" FontSize="11" Margin="0,2,0,0"/>
          </StackPanel>
        </Grid>
      </Border>

      <StackPanel Grid.Row="1" Margin="26,18,26,16">
        <Border Background="{StaticResource Surface2}" CornerRadius="8" Padding="16,14"
                BorderThickness="1" BorderBrush="{StaticResource Border1}">
          <StackPanel>
            <TextBlock Foreground="{StaticResource TextSec}" FontSize="10" FontWeight="SemiBold" Text="파일명"/>
            <TextBlock x:Name="FileNameTB" FontSize="12" FontWeight="SemiBold"
                       TextTrimming="CharacterEllipsis" MaxWidth="420" Margin="0,3,0,0"/>
            <TextBlock Foreground="{StaticResource TextSec}" FontSize="10" FontWeight="SemiBold"
                       Text="카테고리" Margin="0,12,0,0"/>
            <TextBlock x:Name="CategoryTB" FontSize="12" Margin="0,3,0,0"/>
            <TextBlock Foreground="{StaticResource TextSec}" FontSize="10" FontWeight="SemiBold"
                       Text="SHA-256" Margin="0,12,0,0"/>
            <TextBlock x:Name="Sha256TB" FontFamily="Consolas, Cascadia Mono" FontSize="10"
                       Foreground="{StaticResource TextSec}" Margin="0,3,0,0"
                       TextTrimming="CharacterEllipsis" MaxWidth="420"/>
          </StackPanel>
        </Border>
      </StackPanel>

      <Border Grid.Row="2" Background="{StaticResource SurfaceLow}" CornerRadius="0,0,14,14">
        <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="18,14">
          <Button x:Name="OkBtn" Content="확인" Style="{StaticResource Primary}" IsDefault="True"/>
        </StackPanel>
      </Border>
    </Grid>
  </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $window = [Windows.Markup.XamlReader]::Load($reader)
    $window.FindName('FileNameTB').Text = $Filename
    $window.FindName('CategoryTB').Text = $Category
    $window.FindName('Sha256TB').Text   = $Sha256

    _LoadWindowIcon -Window $window -IconPath $IconPath -HeaderImg $null

    $window.FindName('HeaderBar').Add_MouseLeftButtonDown({ $window.DragMove() })
    $window.FindName('OkBtn').Add_Click({ $window.Close() })
    $window.Add_KeyDown({
        if ($_.Key -eq 'Escape' -or $_.Key -eq 'Return') { $window.Close() }
    })

    [void]$window.ShowDialog()
}
