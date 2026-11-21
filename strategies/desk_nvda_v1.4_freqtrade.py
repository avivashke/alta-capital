# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: מניות · NVIDIA (שעתי) · NVDA · 1h
# Version: v1.4 · Strategy family: ema_trend
# Backtest: return 42.5% · PF 3.44 · DD 4.91% · trades 36
# OOS: 33.74% · Sharpe 15.55
# Params: {"fast":23,"slow":37,"atrStop":1.4,"rr":3.6,"trendFilter":false}
# Target platform: Freqtrade
# Generated: 2026-11-21T06:51:29.807Z
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

    stoploss = -0.017
    minimal_roi = {"0": 3.24, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['ema_fast'] = ta.EMA(dataframe, timeperiod=23)
        dataframe['ema_slow'] = ta.EMA(dataframe, timeperiod=37)
        dataframe['ema_trend'] = ta.EMA(dataframe, timeperiod=200)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['ema_fast'] > dataframe['ema_slow'])
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['ema_fast'] < dataframe['ema_slow'])
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
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['ema_fast'] < dataframe['ema_slow'])
            ),
            'exit_long',
        ] = 1
        return dataframe
