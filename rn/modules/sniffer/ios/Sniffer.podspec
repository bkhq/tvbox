Pod::Spec.new do |s|
  s.name           = 'Sniffer'
  s.version        = '1.0.0'
  s.summary        = 'Hidden WebView that reports the requests of a page'
  s.description    = 'Hidden WebView that reports the requests of a page'
  s.author         = ''
  s.homepage       = 'https://github.com/bkhq/tvbox'
  # tvOS has no WebKit: the module builds there but reports isSupported() == false.
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.ios.frameworks = 'WebKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
