# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: מניות · NVIDIA (שעתי) · NVDA · 1h
# Version: v1.0 · Strategy family: ema_trend
# Backtest: return 20.7% · PF 2.43 · DD 5.46% · trades 25
# OOS: 19.54% · Sharpe 7.2
# Params: {"fast":28,"slow":108,"atrStop":1,"rr":3.1,"trendFilter":true}
# Target platform: Freqtrade
# Generated: 2026-11-19T10:42:53.814Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_nvda --config user_data/config.json
#   freqtrade trade --strategy Altadesk_nvda --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_nvda(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '1h'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.012
    minimal_roi = {"0": 2.79, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['ema_fast'] = ta.EMA(dataframe, timeperiod=28)
        dataframe['ema_slow'] = ta.EMA(dataframe, timeperiod=108)
        dataframe['ema_trend'] = ta.EMA(dataframe, timeperiod=200)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['ema_fast'] > dataframe['ema_slow'])
        & (dataframe['close'] > dataframe['ema_trend'])
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['ema_fast'] < dataframe['ema_slow'])
        & (dataframe['close'] < dataframe['ema_trend'])
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['ema_fast'] > dataframe['ema_slow'])
        & (dataframe['close'] > dataframe['ema_trend'])
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['ema_fast'] < dataframe['ema_slow'])
        & (dataframe['close'] < dataframe['ema_trend'])
            ),
            'exit_long',
        ] = 1
        return dataframe
