# mpv view for iOS / tvOS. libmpv comes from the MPVKit (LGPL) xcframeworks that
# fetch-mpvkit.sh downloads into Frameworks/ (gitignored). Without them the module
# still compiles and MpvModule.isAvailable() returns false, so the app falls back to
# the video engine.
frameworks = Dir.glob(File.join(__dir__, 'Frameworks', '*.xcframework')).sort.map do |path|
  "Frameworks/#{File.basename(path)}"
end

Pod::Spec.new do |s|
  s.name           = 'TvboxMpv'
  s.version        = '1.0.0'
  s.summary        = 'mpv player view backed by MPVKit'
  s.description    = s.summary
  s.license        = 'LGPL-2.1-or-later'
  s.author         = 'tvbox'
  s.homepage       = 'https://github.com/mpvkit/MPVKit'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.swift'

  unless frameworks.empty?
    s.vendored_frameworks = frameworks
    # Same system dependencies as MPVKit's Package.swift (_MPVKit / _FFmpeg targets).
    s.frameworks = 'AVFoundation', 'AudioToolbox', 'CoreAudio', 'CoreFoundation', 'CoreMedia',
                   'CoreVideo', 'Metal', 'QuartzCore', 'VideoToolbox'
    s.libraries = 'bz2', 'iconv', 'expat', 'resolv', 'xml2', 'z', 'c++'
  end

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
