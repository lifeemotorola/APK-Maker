#include "streaming.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <stdexcept>

namespace choir {
static void le(std::ostream& out, uint32_t value, int bytes) {
    for (int i = 0; i < bytes; ++i) out.put(static_cast<char>((value >> (8 * i)) & 255));
}
static void writeFloat(std::ostream& out, float value) {
    static_assert(sizeof(float) == 4, "Need 32-bit float analysis samples");
    uint32_t bits;
    std::memcpy(&bits, &value, 4);
    le(out, bits, 4);
}
void streamVocals(const std::string& pcm, const std::string& wav,
                  const Predictor& predict, const Progress& progress,
                  const std::function<void()>& checkCancel) {
    checkCancel();
    std::ifstream input(pcm, std::ios::binary | std::ios::ate);
    if (!input) throw std::runtime_error("Missing PCM input");
    auto bytes = static_cast<long long>(input.tellg());
    if (bytes < SAMPLE_RATE || bytes > static_cast<long long>(MAX_FRAMES) * 4 || bytes % 4)
        throw std::runtime_error("Choose audio between 0.25 seconds and 15 minutes");
    const int frames = static_cast<int>(bytes / 4);
    std::ofstream output(wav, std::ios::binary | std::ios::trunc);
    std::ofstream analysis(wav + ".analysis.f32", std::ios::binary | std::ios::trunc);
    if (!output || !analysis) throw std::runtime_error("Cannot create private vocal output");
    output.write("RIFF", 4); le(output, frames * 4 + 36, 4);
    output.write("WAVEfmt ", 8); le(output, 16, 4); le(output, 1, 2);
    le(output, 2, 2); le(output, SAMPLE_RATE, 4); le(output, SAMPLE_RATE * 4, 4);
    le(output, 4, 2); le(output, 16, 2); output.write("data", 4); le(output, frames * 4, 4);
    bool hadSignal = false;
    double monoSum = 0;
    int monoCount = 0;
    for (int start = 0; start < frames; start += CORE_FRAMES) {
        checkCancel();
        const int end = std::min(frames, start + CORE_FRAMES);
        const int readStart = std::max(0, start - CONTEXT_FRAMES);
        const int readEnd = std::min(frames, end + CONTEXT_FRAMES);
        const int count = readEnd - readStart;
        std::vector<unsigned char> raw(count * 4);
        input.seekg(static_cast<std::streamoff>(readStart) * 4);
        input.read(reinterpret_cast<char*>(raw.data()), raw.size());
        if (!input) throw std::runtime_error("Incomplete PCM input");
        std::vector<float> block(count * 2);
        double sum = 0, sum2 = 0;
        for (int i = 0; i < count; ++i) {
            for (int c = 0; c < 2; ++c) {
                int at = i * 4 + c * 2;
                int value = raw[at] | (static_cast<int>(raw[at + 1]) << 8);
                if (value >= 32768) value -= 65536;
                block[i * 2 + c] = value / 32768.0f;
            }
            double mono = (block[i * 2] + block[i * 2 + 1]) * 0.5;
            sum += mono; sum2 += mono * mono;
        }
        raw.clear(); raw.shrink_to_fit();
        double variance = sum2 / count - (sum / count) * (sum / count);
        if (variance >= 1e-10) {
            hadSignal = true;
            predict(block, [&](float fraction) {
                checkCancel();
                progress((start + std::clamp(fraction, 0.0f, 1.0f) * (end - start)) / frames);
            });
            if (block.size() != static_cast<size_t>(count) * 2)
                throw std::runtime_error("Unexpected vocal block shape");
        } else {
            // Long songs can have silent gaps. Do not normalize by zero or
            // reject an otherwise valid song; keep these exact timestamps.
            std::fill(block.begin(), block.end(), 0.0f);
        }
        // Context is inferred twice but emitted only once: no duplicate/lost
        // frames at joins. Two seconds of context reduce, not eliminate, seams.
        for (int i = start; i < end; ++i) {
            if (i % SAMPLE_RATE == 0) checkCancel();
            float mono = 0;
            for (int c = 0; c < 2; ++c) {
                float value = block[(i - readStart) * 2 + c];
                if (!std::isfinite(value)) throw std::runtime_error("Demucs returned non-finite samples");
                value = std::clamp(value, -1.0f, 1.0f);
                // Fixed gain across all blocks; avoid per-chunk normalization.
                le(output, static_cast<uint16_t>(static_cast<int16_t>(std::lrint(value * 32767))), 2);
                mono += value * 0.5f;
            }
            monoSum += mono;
            if (++monoCount == 4) {
                writeFloat(analysis, static_cast<float>(monoSum / monoCount));
                monoSum = 0; monoCount = 0;
            }
        }
        progress(static_cast<float>(end) / frames);
        if (!output || !analysis) throw std::runtime_error("Vocal output storage is full");
    }
    if (monoCount) writeFloat(analysis, static_cast<float>(monoSum / monoCount));
    checkCancel();
    output.close(); analysis.close();
    if (!output || !analysis) throw std::runtime_error("Could not finish vocal output");
    if (!hadSignal) throw std::runtime_error("No usable audio: song is silent, DC or phase-cancelled");
}
}
