# At the module root (see "podspecPath" in expo-module.config.json) so the
# shared C sources in cpp/ and the bundled libraries in assets/lib/ are
# inside the pod.
Pod::Spec.new do |s|
  s.name           = 'ExpoQuickJS'
  s.version        = '1.0.0'
  s.summary        = 'QuickJS (quickjs-ng) runtime for JS spiders'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'tvbox'
  s.homepage       = 'https://github.com/bkhq/tvbox'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/bkhq/tvbox.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'ios/**/*.swift', 'cpp/qjs_bridge.{h,c}', 'cpp/quickjs-ng/*.{h,c}'
  s.public_header_files = 'cpp/qjs_bridge.h'
  # Engine warnings are upstream's business.
  s.compiler_flags = '-w'
  s.resource_bundles = { 'QuickJSLib' => ['assets/lib/*'] }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'GCC_C_LANGUAGE_STANDARD' => 'gnu11',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) _GNU_SOURCE=1 NDEBUG=1'
  }
end
