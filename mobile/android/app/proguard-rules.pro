# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ============================================================================
# REACT NATIVE CORE
# ============================================================================
-keep class com.facebook.react.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.common.** { *; }

# ============================================================================
# AWS AMPLIFY & APPSYNC - CRITICAL FOR SUBSCRIPTIONS
# ============================================================================

# AWS SDK Core - Prevent obfuscation of AWS classes
-keep class com.amazonaws.** { *; }
-keepnames class com.amazonaws.** { *; }
-dontwarn com.amazonaws.**

# AWS AppSync - CRITICAL: Keep all AppSync classes for GraphQL subscriptions
-keep class com.apollographql.apollo.** { *; }
-keep class com.apollographql.apollo3.** { *; }
-keepnames class com.apollographql.apollo.** { *; }
-keepnames class com.apollographql.apollo3.** { *; }
-dontwarn com.apollographql.apollo.**
-dontwarn com.apollographql.apollo3.**

# Amplify Framework - Keep all Amplify classes
-keep class com.amplifyframework.** { *; }
-keepnames class com.amplifyframework.** { *; }
-dontwarn com.amplifyframework.**

# AWS Mobile Client
-keep class com.amazonaws.mobile.** { *; }
-keepnames class com.amazonaws.mobile.** { *; }
-dontwarn com.amazonaws.mobile.**

# AWS Cognito - For authentication
-keep class com.amazonaws.services.cognitoidentity.** { *; }
-keep class com.amazonaws.services.cognitoidentityprovider.** { *; }
-keep class com.amazonaws.auth.** { *; }
-keepnames class com.amazonaws.services.cognitoidentity.** { *; }
-keepnames class com.amazonaws.services.cognitoidentityprovider.** { *; }
-dontwarn com.amazonaws.services.cognitoidentity.**
-dontwarn com.amazonaws.services.cognitoidentityprovider.**

# AWS DynamoDB - For data persistence
-keep class com.amazonaws.services.dynamodbv2.** { *; }
-keepnames class com.amazonaws.services.dynamodbv2.** { *; }
-dontwarn com.amazonaws.services.dynamodbv2.**

# ============================================================================
# WEBSOCKET & REAL-TIME SUBSCRIPTIONS - CRITICAL
# ============================================================================

# OkHttp - Used by AppSync for WebSocket connections
-keep class okhttp3.** { *; }
-keep class okio.** { *; }
-keepnames class okhttp3.** { *; }
-keepnames class okio.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**

# WebSocket support
-keep class org.java_websocket.** { *; }
-keepnames class org.java_websocket.** { *; }
-dontwarn org.java_websocket.**

# ============================================================================
# JSON SERIALIZATION - CRITICAL FOR GRAPHQL DATA MAPPING
# ============================================================================

# Gson - Used for JSON serialization/deserialization
-keep class com.google.gson.** { *; }
-keepnames class com.google.gson.** { *; }
-keepclassmembers,allowobfuscation class * {
  @com.google.gson.annotations.SerializedName <fields>;
}
-dontwarn com.google.gson.**

# Keep all model classes and their fields for JSON mapping
-keepclassmembers class * {
  @com.google.gson.annotations.SerializedName <fields>;
}

# Jackson - Alternative JSON library
-keep class com.fasterxml.jackson.** { *; }
-keepnames class com.fasterxml.jackson.** { *; }
-dontwarn com.fasterxml.jackson.**

# Keep all fields and methods that might be accessed via reflection
-keepclassmembers class * {
  @com.fasterxml.jackson.annotation.** *;
}

# ============================================================================
# REFLECTION & INTROSPECTION - CRITICAL FOR APPSYNC
# ============================================================================

# Keep classes that use reflection (AppSync uses reflection for GraphQL mapping)
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses

# Keep generic signatures for proper type inference
-keepattributes Signature

# Keep source file names and line numbers for better crash reports
-keepattributes SourceFile,LineNumberTable

# ============================================================================
# UNSAFE & LOW-LEVEL OPERATIONS
# ============================================================================

# sun.misc.Unsafe - Used by some AWS libraries
-keep class sun.misc.Unsafe { *; }
-dontwarn sun.misc.Unsafe

# Java NIO
-keep class java.nio.** { *; }
-dontwarn java.nio.**

# ============================================================================
# GOOGLE PLAY SERVICES & OAUTH
# ============================================================================

# Google Play Services
-keep class com.google.android.gms.** { *; }
-keepnames class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# Google Sign-In
-keep class com.google.android.gms.auth.** { *; }
-keep class com.google.android.gms.common.** { *; }
-dontwarn com.google.android.gms.auth.**

# ============================================================================
# REACT NATIVE MODULES
# ============================================================================

# AsyncStorage
-keep class com.reactnativecommunity.asyncstorage.** { *; }
-keepnames class com.reactnativecommunity.asyncstorage.** { *; }

# React Native Gesture Handler
-keep class com.swmansion.gesturehandler.** { *; }
-keepnames class com.swmansion.gesturehandler.** { *; }

# React Native Screens
-keep class com.swmansion.rnscreens.** { *; }
-keepnames class com.swmansion.rnscreens.** { *; }

# React Native Safe Area Context
-keep class com.th3rdwave.safeareacontext.** { *; }
-keepnames class com.th3rdwave.safeareacontext.** { *; }

# React Native SVG
-keep class com.horcrux.svg.** { *; }
-keepnames class com.horcrux.svg.** { *; }

# React Native Google Sign-In
-keep class co.apptailor.googlesignin.** { *; }
-keepnames class co.apptailor.googlesignin.** { *; }

# Expo modules
-keep class expo.modules.** { *; }
-keepnames class expo.modules.** { *; }

# ============================================================================
# JAVASCRIPT ENGINE (HERMES)
# ============================================================================

# Hermes
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jsi.** { *; }

# ============================================================================
# NETWORKING & HTTP
# ============================================================================

# Apache HTTP
-keep class org.apache.http.** { *; }
-dontwarn org.apache.http.**

# ============================================================================
# KOTLIN & COROUTINES
# ============================================================================

# Kotlin
-keep class kotlin.** { *; }
-keep class kotlinx.** { *; }
-dontwarn kotlin.**
-dontwarn kotlinx.**

# Kotlin Coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# ============================================================================
# GENERAL OPTIMIZATIONS
# ============================================================================

# Don't warn about missing classes
-dontwarn javax.annotation.**
-dontwarn javax.inject.**
-dontwarn sun.misc.**

# Optimization settings
-optimizationpasses 5
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-verbose

# ============================================================================
# DEBUGGING (Remove in production if needed)
# ============================================================================

# Keep crash reporting information
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Add any project specific keep options here:
