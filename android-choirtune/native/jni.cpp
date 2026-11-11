#include "engine.hpp"
#include <jni.h>
#include <exception>
#include <new>

extern "C" JNIEXPORT void JNICALL
Java_com_choirtune_app_DemucsController_reset(JNIEnv*, jclass) {
    choir::cancelled = false;
    choir::progress = 0;
}
extern "C" JNIEXPORT void JNICALL
Java_com_choirtune_app_DemucsController_cancelNative(JNIEnv*, jclass) { choir::cancelled = true; }
extern "C" JNIEXPORT jfloat JNICALL
Java_com_choirtune_app_DemucsController_progressNative(JNIEnv*, jclass) { return choir::progress.load(); }

extern "C" JNIEXPORT jstring JNICALL
Java_com_choirtune_app_DemucsController_runNative(JNIEnv* env, jclass, jstring model, jstring pcm, jstring wav) {
    const char* m = env->GetStringUTFChars(model, nullptr);
    if (!m) return nullptr;
    const char* p = env->GetStringUTFChars(pcm, nullptr);
    if (!p) { env->ReleaseStringUTFChars(model, m); return nullptr; }
    const char* w = env->GetStringUTFChars(wav, nullptr);
    if (!w) { env->ReleaseStringUTFChars(model, m); env->ReleaseStringUTFChars(pcm, p); return nullptr; }
    std::string error;
    try { choir::isolate(m, p, w); }
    catch (const std::bad_alloc&) { error = "Insufficient memory for Demucs. Close other apps and try a shorter clip."; }
    catch (const std::exception& e) { error = e.what(); }
    catch (...) { error = "Native Demucs inference failed"; }
    env->ReleaseStringUTFChars(model, m);
    env->ReleaseStringUTFChars(pcm, p);
    env->ReleaseStringUTFChars(wav, w);
    return env->NewStringUTF(error.c_str());
}
