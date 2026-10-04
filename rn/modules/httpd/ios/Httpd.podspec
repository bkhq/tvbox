Pod::Spec.new do |s|
  s.name           = 'Httpd'
  s.version        = '1.0.0'
  s.summary        = 'Local HTTP server transport with Bonjour advertising'
  s.description    = 'Local HTTP server transport with Bonjour advertising'
  s.author         = ''
  s.homepage       = 'https://github.com/bkhq/tvbox'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
