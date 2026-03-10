export class RingBuffer<T> {
    private buffer_: T[];
    private capacity_: number;
    private head_ = 0;
    private size_ = 0;

    constructor(capacity: number) {
        this.capacity_ = capacity;
        this.buffer_ = new Array<T>(capacity);
    }

    push(item: T): void {
        this.buffer_[this.head_] = item;
        this.head_ = (this.head_ + 1) % this.capacity_;
        if (this.size_ < this.capacity_) this.size_++;
    }

    toArray(): T[] {
        if (this.size_ === 0) return [];
        if (this.size_ < this.capacity_) {
            return this.buffer_.slice(0, this.size_);
        }
        return [
            ...this.buffer_.slice(this.head_),
            ...this.buffer_.slice(0, this.head_),
        ];
    }

    recent(count: number): T[] {
        const all = this.toArray();
        if (count >= all.length) return all;
        return all.slice(all.length - count);
    }

    clear(): void {
        this.head_ = 0;
        this.size_ = 0;
    }

    get length(): number {
        return this.size_;
    }
}
